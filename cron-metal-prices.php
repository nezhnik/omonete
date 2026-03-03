<?php
/**
 * Крон для Reg.ru: цены металлов ЦБ, курс доллара ЦБ, медь RusCable → БД → data/metal-prices.json.
 * Запуск: php cron-metal-prices.php (или в планировщике Reg.ru).
 * Нужен .env в той же папке с DATABASE_URL=mysql://user:password@host:3306/database
 */
error_reporting(E_ALL);
ini_set('display_errors', 0);

$CBR_SOAP_URL = 'https://www.cbr.ru/DailyInfoWebServ/DailyInfo.asmx';
$CBR_DAILY_JSON = 'https://www.cbr-xml-daily.ru/daily_json.js';
$CBR_ARCHIVE = 'https://www.cbr-xml-daily.ru/archive';
$RUSCABLE_URL = 'https://www.ruscable.ru/quotation/assets/ajax/lme.php';
$CBR_COD = [1 => 'xau', 2 => 'xag', 3 => 'xpt', 4 => 'xpd'];
const GRAMS_PER_TROY_OZ = 31.1035;

// Загрузка .env
$envPath = __DIR__ . '/.env';
if (is_file($envPath)) {
    foreach (file($envPath, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES) as $line) {
        if (strpos($line, '=') !== false && strpos(trim($line), '#') !== 0) {
            list($k, $v) = explode('=', $line, 2);
            $v = trim($v, " \t\"'");
            putenv(trim($k) . '=' . $v);
            $_ENV[trim($k)] = $v;
        }
    }
}
$databaseUrl = getenv('DATABASE_URL') ?: ($_ENV['DATABASE_URL'] ?? '');
if (!$databaseUrl || !preg_match('#mysql://([^:]+):([^@]+)@([^:]+):(\d+)/(.+)#', $databaseUrl, $m)) {
    exit("DATABASE_URL не задан или неверный формат\n");
}
$dbHost = $m[3];
$dbPort = (int)$m[4];
$dbUser = $m[1];
$dbPass = $m[2];
$dbName = $m[5];

$dsn = "mysql:host=$dbHost;port=$dbPort;dbname=$dbName;charset=utf8mb4";
try {
    $pdo = new PDO($dsn, $dbUser, $dbPass, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
} catch (PDOException $e) {
    exit("Ошибка БД: " . $e->getMessage() . "\n");
}

function isWorkingDay() {
    $d = (int)date('w');
    return $d >= 1 && $d <= 5;
}
$forceRun = (getenv('FORCE_METAL_CRON') === '1' || ($_ENV['FORCE_METAL_CRON'] ?? '') === '1');
$workingDay = $forceRun || isWorkingDay();

// Таблицы
$pdo->exec("CREATE TABLE IF NOT EXISTS metal_prices (
    id INT AUTO_INCREMENT PRIMARY KEY,
    date DATE NOT NULL UNIQUE,
    xau DECIMAL(12,4) NOT NULL DEFAULT 0,
    xag DECIMAL(12,4) NOT NULL DEFAULT 0,
    xpt DECIMAL(12,4) NOT NULL DEFAULT 0,
    xpd DECIMAL(12,4) NOT NULL DEFAULT 0,
    xcu DECIMAL(12,4) NOT NULL DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");
try { $pdo->exec("CREATE INDEX idx_metal_prices_date ON metal_prices (date)"); } catch (PDOException $e) { /* ignore */ }
try { $pdo->exec("ALTER TABLE metal_prices ADD COLUMN xcu DECIMAL(12,4) NOT NULL DEFAULT 0 AFTER xpd"); } catch (PDOException $e) { /* ignore */ }

$pdo->exec("CREATE TABLE IF NOT EXISTS cbr_rates (
    date DATE NOT NULL PRIMARY KEY,
    usd_rub DECIMAL(12,4) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");

// Однократный бэкфилл меди 2006–сегодня: создайте файл .do-copper-backfill в папке со скриптом и запустите php cron-metal-prices.php один раз
$doCopperBackfill = is_file(__DIR__ . '/.do-copper-backfill') || (getenv('BACKFILL_COPPER') === '1' || ($_ENV['BACKFILL_COPPER'] ?? '') === '1');
if ($doCopperBackfill) {
    if (is_file(__DIR__ . '/.do-copper-backfill')) @unlink(__DIR__ . '/.do-copper-backfill');
    $upd = $pdo->prepare("UPDATE metal_prices SET xcu = ? WHERE date = ?");
    $sel = $pdo->prepare("SELECT usd_rub FROM cbr_rates WHERE date = ?");
    $fromYear = 2006;
    $toYear = (int)date('Y');
    for ($y = $fromYear; $y <= $toYear; $y++) {
        $dateFrom = $y === $fromYear ? '2006-01-01' : $y . '-01-01';
        $dateTo = $y === $toYear ? date('Y-m-d') : $y . '-12-31';
        $json = httpGet($RUSCABLE_URL . '?date_from=' . $dateFrom . '&date_to=' . $dateTo);
        if (!$json) continue;
        $rc = @json_decode($json, true);
        $dates = $rc['copper']['dates'] ?? [];
        $ranks = $rc['copper']['ranks'] ?? [];
        $n = 0;
        for ($i = 0; $i < count($dates); $i++) {
            $dateStr = $dates[$i] ?? null;
            $usdPerTonne = isset($ranks[$i]) ? (float)$ranks[$i] : 0;
            if (!$dateStr || !$usdPerTonne) continue;
            $sel->execute([$dateStr]);
            $row = $sel->fetch(PDO::FETCH_OBJ);
            if (!$row || !$row->usd_rub) continue;
            $xcu = round(($usdPerTonne / 1e6) * (float)$row->usd_rub * GRAMS_PER_TROY_OZ, 2);
            $upd->execute([$xcu, $dateStr]);
            $n++;
        }
        if ($n > 0) { /* optional: log */ }
        usleep(300000); // 0.3 s между годами
    }
}

function httpGet($url) {
    $ctx = stream_context_create(['http' => ['timeout' => 15]]);
    $s = @file_get_contents($url, false, $ctx);
    return $s !== false ? $s : null;
}
function httpPost($url, $body, $headers = []) {
    $opts = [
        'http' => [
            'method' => 'POST',
            'header' => "Content-Type: text/xml; charset=utf-8\r\nSOAPAction: http://web.cbr.ru/DragMetDynamic\r\n",
            'content' => $body,
            'timeout' => 30,
        ]
    ];
    $ctx = stream_context_create($opts);
    $s = @file_get_contents($url, false, $ctx);
    return $s !== false ? $s : null;
}

if ($workingDay) {
    try {
        // Курсы ЦБ за последние 3 дня
        for ($i = 0; $i <= 3; $i++) {
            $dateStr = date('Y-m-d', strtotime("-$i days"));
            $url = $i === 0 ? $GLOBALS['CBR_DAILY_JSON'] : $GLOBALS['CBR_ARCHIVE'] . '/' . date('Y/m/d', strtotime("-$i days")) . '/daily_json.js';
            $json = httpGet($url);
            if (!$json) continue;
            $data = @json_decode($json, true);
            if (empty($data['Valute']['USD']['Value'])) continue;
            $usdRub = (float)$data['Valute']['USD']['Value'];
            $st = $pdo->prepare("INSERT INTO cbr_rates (date, usd_rub) VALUES (?, ?) ON DUPLICATE KEY UPDATE usd_rub = VALUES(usd_rub)");
            $st->execute([$dateStr, $usdRub]);
        }

        // Металлы ЦБ за последние 3 дня
        $start = date('Y-m-d', strtotime('-3 days'));
        $end = date('Y-m-d');
        $body = '<?xml version="1.0" encoding="utf-8"?><soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"><soap:Body><DragMetDynamic xmlns="http://web.cbr.ru/"><fromDate>' . $start . 'T00:00:00</fromDate><ToDate>' . $end . 'T00:00:00</ToDate></DragMetDynamic></soap:Body></soap:Envelope>';
        $xml = httpPost($CBR_SOAP_URL, $body);
        if ($xml && preg_match_all('#<DrgMet[^>]*>([\s\S]*?)</DrgMet>#i', $xml, $blocks)) {
            $byDate = [];
            foreach ($blocks[1] as $block) {
                if (preg_match('#<DateMet[^>]*>([^<]+)#', $block, $dm) && preg_match('#<CodMet[^>]*>([^<]+)#', $block, $cm) && preg_match('#<price[^>]*>([^<]+)#', $block, $pr)) {
                    $date = substr(trim($dm[1]), 0, 10);
                    $cod = (int)$cm[1];
                    $price = (float)str_replace(',', '.', trim($pr[1]));
                    if (!isset($byDate[$date])) $byDate[$date] = ['date' => $date, 'xau' => 0, 'xag' => 0, 'xpt' => 0, 'xpd' => 0, 'xcu' => 0];
                    if (isset($CBR_COD[$cod])) $byDate[$date][$CBR_COD[$cod]] = $price;
                }
            }
            $ins = $pdo->prepare("INSERT INTO metal_prices (date, xau, xag, xpt, xpd, xcu) VALUES (?, ?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE xau=VALUES(xau), xag=VALUES(xag), xpt=VALUES(xpt), xpd=VALUES(xpd), xcu=VALUES(xcu)");
            foreach ($byDate as $row) {
                $ins->execute([$row['date'], $row['xau'], $row['xag'], $row['xpt'], $row['xpd'], $row['xcu']]);
            }
        }

        // Медь RusCable за последние 3 дня
        $dateFrom = date('Y-m-d', strtotime('-3 days'));
        $dateTo = date('Y-m-d');
        $ruscableJson = httpGet($RUSCABLE_URL . '?date_from=' . $dateFrom . '&date_to=' . $dateTo);
        if ($ruscableJson) {
            $rc = @json_decode($ruscableJson, true);
            $dates = $rc['copper']['dates'] ?? [];
            $ranks = $rc['copper']['ranks'] ?? [];
            $upd = $pdo->prepare("UPDATE metal_prices SET xcu = ? WHERE date = ?");
            $sel = $pdo->prepare("SELECT usd_rub FROM cbr_rates WHERE date = ?");
            for ($i = 0; $i < count($dates); $i++) {
                $dateStr = $dates[$i] ?? null;
                $usdPerTonne = isset($ranks[$i]) ? (float)$ranks[$i] : 0;
                if (!$dateStr || !$usdPerTonne) continue;
                $sel->execute([$dateStr]);
                $r = $sel->fetch(PDO::FETCH_OBJ);
                if (!$r || !$r->usd_rub) continue;
                $xcu = round(($usdPerTonne / 1e6) * (float)$r->usd_rub * GRAMS_PER_TROY_OZ, 2);
                $upd->execute([$xcu, $dateStr]);
            }
        }
    } catch (Throwable $e) {
        // логируем и продолжаем — экспорт всё равно сделаем
    }
}

// Экспорт из БД в JSON (всегда)
$stmt = $pdo->query("SELECT date, xau, xag, xpt, xpd, xcu FROM metal_prices ORDER BY date");
$allRows = $stmt ? $stmt->fetchAll(PDO::FETCH_ASSOC) : [];
foreach ($allRows as &$r) {
    $r['date'] = substr($r['date'], 0, 10);
    $r['xau'] = (float)$r['xau'];
    $r['xag'] = (float)$r['xag'];
    $r['xpt'] = (float)$r['xpt'];
    $r['xpd'] = (float)$r['xpd'];
    $r['xcu'] = (float)($r['xcu'] ?? 0);
}
unset($r);

$today = date('Y-m-d');
$cbrFirst = '2003-07-07';

function getRangeForPeriod(array $rows, $period) {
    global $today, $cbrFirst;
    $end = $today;
    if ($period === '1m') $start = date('Y-m-d', strtotime('-1 month'));
    elseif ($period === '1y') $start = date('Y-m-d', strtotime('-1 year'));
    elseif ($period === '5y') $start = date('Y-m-d', strtotime('-5 years'));
    elseif ($period === '10y') $start = date('Y-m-d', strtotime('-10 years'));
    elseif ($period === 'all') $start = $cbrFirst;
    else return [];
    return array_values(array_filter($rows, function ($r) use ($start, $end) { return $r['date'] >= $start && $r['date'] <= $end; }));
}

function buildPeriodResponse(array $rows, $period) {
    $range = getRangeForPeriod($rows, $period);
    if (empty($range)) return null;
    $round = function ($v) { return round((float)$v * 100) / 100; };
    $ruMonths = ['', 'янв.', 'фев.', 'мар.', 'апр.', 'мая', 'июн.', 'июл.', 'авг.', 'сен.', 'окт.', 'нояб.', 'дек.'];
    $fmtShort = function ($d) use ($ruMonths) {
        $t = strtotime($d . ' 12:00:00');
        return date('j', $t) . ' ' . $ruMonths[(int)date('n', $t)];
    };
    $fmtShortY = function ($d) use ($ruMonths) {
        $t = strtotime($d . ' 12:00:00');
        return date('j', $t) . ' ' . $ruMonths[(int)date('n', $t)] . ' ' . date('y', $t);
    };
    $fmtMonth = function ($d) use ($ruMonths) {
        $t = strtotime($d . ' 12:00:00');
        return $ruMonths[(int)date('n', $t)] . ' ' . date('y', $t);
    };

    if ($period === 'all') {
        // 1 точка за 2 недели — детализированный график
        $getBiweekKey = function ($dateStr) {
            return (int) floor(strtotime($dateStr . ' 12:00:00') / (14 * 86400));
        };
        $byBiweek = [];
        foreach ($range as $r) {
            $k = $getBiweekKey($r['date']);
            $byBiweek[$k] = $r;
        }
        ksort($byBiweek);
        $sampled = array_values($byBiweek);
        foreach ($sampled as &$s) { $s['label'] = $fmtMonth($s['date']); }
    } else {
        // 1m, 1y, 5y, 10y — по дням, без группировки (как 1y)
        // Группировка по неделям для 5y/10y давала 1 точку на проде при малой БД
        $sampled = $range;
        foreach ($sampled as &$s) {
            $s['label'] = in_array($period, ['1y', '5y', '10y']) ? $fmtShortY($s['date']) : $fmtShort($s['date']);
        }
    }
    unset($s);

    // Игнорируем строки с нулевыми значениями по каждому металлу —
    // иначе провалы до 0 (из-за строк только с медью или технических сбоев) попадали в график.
    $filterNonZero = function (array $rows, $key) {
        return array_values(array_filter($rows, function ($s) use ($key) {
            return isset($s[$key]) && (float)$s[$key] > 0;
        }));
    };

    $rowsXau = $filterNonZero($sampled, 'xau');
    $rowsXag = $filterNonZero($sampled, 'xag');
    $rowsXpt = $filterNonZero($sampled, 'xpt');
    $rowsXpd = $filterNonZero($sampled, 'xpd');

    $res = [
        'ok' => true,
        'period' => $period,
        'source' => 'static',
        'XAU' => array_map(function ($s) use ($round) { return ['label' => $s['label'], 'value' => $round($s['xau'])]; }, $rowsXau),
        'XAG' => array_map(function ($s) use ($round) { return ['label' => $s['label'], 'value' => $round($s['xag'])]; }, $rowsXag),
        'XPT' => array_map(function ($s) use ($round) { return ['label' => $s['label'], 'value' => $round($s['xpt'])]; }, $rowsXpt),
        'XPD' => array_map(function ($s) use ($round) { return ['label' => $s['label'], 'value' => $round($s['xpd'])]; }, $rowsXpd),
    ];

    // Медь: данные с 2006 (RusCable), для периода «Все» начинаем с 2006
    $sampledCuBase = $period === 'all'
        ? array_values(array_filter($sampled, function ($s) { return $s['date'] >= '2006-01-01'; }))
        : $sampled;
    $sampledCu = $filterNonZero($sampledCuBase, 'xcu');
    if (!empty($sampledCu)) {
        $res['XCU'] = array_map(function ($s) use ($round) { return ['label' => $s['label'], 'value' => $round($s['xcu'])]; }, $sampledCu);
    }
    return $res;
}

$out = [];
foreach (['1m', '1y', '5y', '10y', 'all'] as $p) {
    $resp = buildPeriodResponse($allRows, $p);
    if ($resp && !empty($resp['XAU'])) $out[$p] = $resp;
}

$dataDir = __DIR__ . '/data';
if (!is_dir($dataDir)) mkdir($dataDir, 0755, true);
$outputFile = $dataDir . '/metal-prices.json';
file_put_contents($outputFile, json_encode($out, JSON_UNESCAPED_UNICODE));

// Статус последнего запуска — откройте на сайте https://ваш-домен.ru/data/cron-metal-last.json чтобы убедиться, что крон сработал
$last1m = isset($out['1m']['XAU']) && count($out['1m']['XAU']) ? end($out['1m']['XAU']) : null;
$status = [
    'ok' => true,
    'lastRun' => date('c'),
    'lastRunLabel' => date('d.m.Y H:i'),
    'message' => 'Крон выполнен. Данные обновлены и записаны в data/metal-prices.json.',
    'lastDate1m' => $last1m ? $last1m['label'] : null,
    'periods' => array_keys($out),
];
file_put_contents($dataDir . '/cron-metal-last.json', json_encode($status, JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT));
