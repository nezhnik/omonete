<?php
/**
 * Крон раз в день на Reg.ru: ЦБ РФ → MySQL (metal_prices) → data/metal-prices.json.
 * Положи в корень сайта (www/omonete.ru), настрой cron-metal-prices-config.php, в планировщике: раз в день запускать этот файл через PHP.
 */
declare(strict_types=1);

define('CRON_METAL_PRICES', true);
$configPath = __DIR__ . '/cron-metal-prices-config.php';
if (!is_file($configPath)) {
    fwrite(STDERR, "Создай cron-metal-prices-config.php с переменными \$dbHost, \$dbUser, \$dbPass, \$dbName\n");
    exit(1);
}
require $configPath;

$dataDir = __DIR__ . '/data';
$outputFile = $dataDir . '/metal-prices.json';
$cbrUrl = 'https://www.cbr.ru/DailyInfoWebServ/DailyInfo.asmx';
$codMap = [1 => 'xau', 2 => 'xag', 3 => 'xpt', 4 => 'xpd'];

/** ЦБ публикует цены только в рабочие дни (пн–пт). В выходные запрос не делаем. */
function isCbrWorkingDay(): bool {
    $w = (int) date('w');
    return $w !== 0 && $w !== 6;
}

function fetchCbrRange(string $startDate, string $endDate, string $cbrUrl, array $codMap): array {
    $from = $startDate . 'T00:00:00';
    $to = $endDate . 'T00:00:00';
    $body = '<?xml version="1.0" encoding="utf-8"?><soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema"><soap:Body><DragMetDynamic xmlns="http://web.cbr.ru/"><fromDate>' . $from . '</fromDate><ToDate>' . $to . '</ToDate></DragMetDynamic></soap:Body></soap:Envelope>';
    $ctx = stream_context_create([
        'http' => [
            'method' => 'POST',
            'header' => "Content-Type: text/xml; charset=utf-8\r\nSOAPAction: http://web.cbr.ru/DragMetDynamic\r\n",
            'content' => $body,
            'timeout' => 30,
        ],
    ]);
    $xml = @file_get_contents($cbrUrl, false, $ctx);
    if ($xml === false) return [];
    $byDate = [];
    if (preg_match_all('/<DrgMet[^>]*>([\s\S]*?)<\/DrgMet>/ui', $xml, $blocks, PREG_SET_ORDER)) {
        foreach ($blocks as $m) {
            $block = $m[1];
            if (!preg_match('/<DateMet[^>]*>([^<]+)/', $block, $d) || !preg_match('/<CodMet[^>]*>([^<]+)/', $block, $c) || !preg_match('/<price[^>]*>([^<]+)/', $block, $p)) continue;
            $date = substr(trim($d[1]), 0, 10);
            $cod = (int) $c[1];
            $col = $codMap[$cod] ?? null;
            if (!$col) continue;
            $price = (float) str_replace(',', '.', trim($p[1]));
            if (!isset($byDate[$date])) $byDate[$date] = ['date' => $date, 'xau' => 0.0, 'xag' => 0.0, 'xpt' => 0.0, 'xpd' => 0.0];
            $byDate[$date][$col] = $price;
        }
    }
    ksort($byDate);
    return array_values($byDate);
}

function ensureTable(PDO $pdo): void {
    $pdo->exec("CREATE TABLE IF NOT EXISTS metal_prices (
        id INT AUTO_INCREMENT PRIMARY KEY,
        date DATE NOT NULL UNIQUE,
        xau DECIMAL(12,4) NOT NULL DEFAULT 0,
        xag DECIMAL(12,4) NOT NULL DEFAULT 0,
        xpt DECIMAL(12,4) NOT NULL DEFAULT 0,
        xpd DECIMAL(12,4) NOT NULL DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");
    try {
        $pdo->exec('CREATE INDEX idx_metal_prices_date ON metal_prices (date)');
    } catch (Throwable $e) {
        if (strpos($e->getMessage(), 'Duplicate key') === false) throw $e;
    }
}

function insertRows(PDO $pdo, array $rows): void {
    $stmt = $pdo->prepare('INSERT INTO metal_prices (date, xau, xag, xpt, xpd) VALUES (?,?,?,?,?) ON DUPLICATE KEY UPDATE xau=VALUES(xau), xag=VALUES(xag), xpt=VALUES(xpt), xpd=VALUES(xpd)');
    foreach ($rows as $r) {
        $stmt->execute([$r['date'], $r['xau'], $r['xag'], $r['xpt'], $r['xpd']]);
    }
}

function dateTo(string $d): string {
    return (new DateTime($d))->format('Y-m-d');
}

function getRangeForPeriod(array $rows, string $period): array {
    $end = new DateTime();
    $start = clone $end;
    switch ($period) {
        case '1w': $start->modify('-6 days'); break;
        case '1m': $start->modify('-1 month'); break;
        case '1y': $start->modify('-1 year'); break;
        case '5y': $start->modify('-5 years'); break;
        case '10y': $start->modify('-10 years'); break;
        default: return [];
    }
    $startStr = $start->format('Y-m-d');
    $endStr = $end->format('Y-m-d');
    return array_filter($rows, fn($r) => $r['date'] >= $startStr && $r['date'] <= $endStr);
}

function buildPeriodResponse(array $rows, string $period): ?array {
    $range = getRangeForPeriod($rows, $period);
    if (empty($range)) return null;
    $locale = 'ru_RU';
    $fmtShort = new IntlDateFormatter($locale, IntlDateFormatter::NONE, IntlDateFormatter::NONE, null, null, 'd MMM');
    $fmtYear = new IntlDateFormatter($locale, IntlDateFormatter::NONE, IntlDateFormatter::NONE, null, null, 'd MMM yy');
    if ($period === '5y' || $period === '10y') {
        $byWeek = [];
        foreach ($range as $r) {
            $dt = new DateTime($r['date'] . 'T12:00:00');
            $day = (int) $dt->format('w');
            $dt->modify($day === 0 ? '-6 days' : '-' . ($day - 1) . ' days');
            $key = $dt->format('Y-m-d');
            $byWeek[$key] = $r;
        }
        ksort($byWeek);
        $sampled = [];
        foreach ($byWeek as $r) {
            $sampled[] = [
                'label' => $fmtYear->format(new DateTime($r['date'])),
                'xau' => (float) $r['xau'], 'xag' => (float) $r['xag'], 'xpt' => (float) $r['xpt'], 'xpd' => (float) $r['xpd'],
            ];
        }
    } else {
        $sampled = [];
        foreach ($range as $r) {
            $label = $period === '1y'
                ? $fmtYear->format(new DateTime($r['date']))
                : $fmtShort->format(new DateTime($r['date']));
            $sampled[] = [
                'label' => $label,
                'xau' => (float) $r['xau'], 'xag' => (float) $r['xag'], 'xpt' => (float) $r['xpt'], 'xpd' => (float) $r['xpd'],
            ];
        }
    }
    $round = fn($v) => round((float) $v, 2);
    return [
        'ok' => true,
        'period' => $period,
        'source' => 'static',
        'XAU' => array_map(fn($s) => ['label' => $s['label'], 'value' => $round($s['xau'])], $sampled),
        'XAG' => array_map(fn($s) => ['label' => $s['label'], 'value' => $round($s['xag'])], $sampled),
        'XPT' => array_map(fn($s) => ['label' => $s['label'], 'value' => $round($s['xpt'])], $sampled),
        'XPD' => array_map(fn($s) => ['label' => $s['label'], 'value' => $round($s['xpd'])], $sampled),
    ];
}

try {
    $dsn = sprintf('mysql:host=%s;port=%s;dbname=%s;charset=utf8mb4', $dbHost, $dbPort ?? 3306, $dbName);
    $pdo = new PDO($dsn, $dbUser, $dbPass, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
} catch (Throwable $e) {
    fwrite(STDERR, "MySQL: " . $e->getMessage() . "\n");
    exit(1);
}

ensureTable($pdo);

$workingDay = isCbrWorkingDay();
$count = (int) $pdo->query('SELECT COUNT(*) FROM metal_prices')->fetchColumn();

if ($count < 500 && $workingDay) {
    $total = 0;
    for ($i = 0; $i < 10; $i++) {
        $yEnd = new DateTime();
        $yEnd->modify('-' . (9 - $i) . ' years');
        $yStart = clone $yEnd;
        $yStart->modify('-1 year');
        $rows = fetchCbrRange($yStart->format('Y-m-d'), $yEnd->format('Y-m-d'), $cbrUrl, $codMap);
        if (!empty($rows)) {
            insertRows($pdo, $rows);
            $total += count($rows);
        }
    }
    if ($total > 0) echo "ЦБ → БД (10 лет): $total дней\n";
} elseif ($count < 500 && !$workingDay) {
    echo "Бэкфилл пропущен (выходной ЦБ). Запусти крон в рабочий день.\n";
}

if ($workingDay) {
    $end = new DateTime();
    $start = clone $end;
    $start->modify('-3 days');
    $fresh = fetchCbrRange($start->format('Y-m-d'), $end->format('Y-m-d'), $cbrUrl, $codMap);
    if (!empty($fresh)) {
        insertRows($pdo, $fresh);
        echo "ЦБ → БД (свежие): " . count($fresh) . " дней\n";
    }

    $stmt = $pdo->query('SELECT date, xau, xag, xpt, xpd FROM metal_prices ORDER BY date');
    $allRows = [];
    while ($row = $stmt->fetch(PDO::FETCH_ASSOC)) {
        $allRows[] = [
            'date' => substr($row['date'], 0, 10),
            'xau' => (float) $row['xau'], 'xag' => (float) $row['xag'], 'xpt' => (float) $row['xpt'], 'xpd' => (float) $row['xpd'],
        ];
    }

    $out = [];
    foreach (['1w', '1m', '1y', '5y', '10y'] as $p) {
        $resp = buildPeriodResponse($allRows, $p);
        if ($resp && !empty($resp['XAU'])) $out[$p] = $resp;
    }

    if (!is_dir($dataDir)) mkdir($dataDir, 0755, true);
    file_put_contents($outputFile, json_encode($out, JSON_UNESCAPED_UNICODE));
    echo "БД → $outputFile\n";
} else {
    echo "Выходной ЦБ: запрос и экспорт пропущены, новых данных нет.\n";
}
