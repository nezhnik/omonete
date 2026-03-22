/**
 * Отчёт по монетам в БД без числового тиража и без текстового mintage_display
 * (тираж «пустой» с точки зрения полей в таблице coins).
 *
 * Опционально — запрос страницы source_url (Royal Mint / Perth) и поиск строки Mintage в HTML
 * (эвристика, не замена полноценного парсера).
 *
 * Запуск (из корня omonete-app, нужен DATABASE_URL в .env):
 *   node scripts/report-coins-missing-mintage.js
 *   node scripts/report-coins-missing-mintage.js --probe        — подтянуть подсказки с сайта (медленно)
 *   node scripts/report-coins-missing-mintage.js --probe --limit 15
 *
 * Выход:
 *   data/coins-missing-mintage-report.json
 *   консоль: краткая сводка
 */
require("dotenv").config({ path: ".env" });
const mysql = require("mysql2/promise");
const fs = require("fs");
const path = require("path");

const DATA_DIR = path.join(__dirname, "..", "data");
const OUT_JSON = path.join(DATA_DIR, "coins-missing-mintage-report.json");

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

function getConfig() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL не задан в .env");
    process.exit(1);
  }
  const m = url.match(/mysql:\/\/([^:]+):([^@]+)@([^:]+):(\d+)\/(.+)/);
  if (!m) {
    console.error("Неверный формат DATABASE_URL");
    process.exit(1);
  }
  const [, user, password, host, port, database] = m;
  return { host, port: parseInt(port, 10), user, password, database };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Ищем в HTML таблицах спецификаций типичные подписи тиража.
 */
function extractMintageHintsFromHtml(html) {
  if (!html || typeof html !== "string") return { raw: null, patterns: [] };
  const patterns = [
    /<th[^>]*>\s*Mintage\s*<\/th>\s*<td[^>]*>([\s\S]*?)<\/td>/gi,
    /<th[^>]*>\s*Maximum\s+Mintage\s*<\/th>\s*<td[^>]*>([\s\S]*?)<\/td>/gi,
    /<th[^>]*>\s*Limited\s+Edition\s*<\/th>\s*<td[^>]*>([\s\S]*?)<\/td>/gi,
    /"Mintage"\s*:\s*"([^"]+)"/i,
    /"MaximumMintage"\s*:\s*"([^"]+)"/i,
  ];
  const found = [];
  for (const re of patterns) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(html)) !== null) {
      const text = m[1].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
      if (text && text.length < 200) found.push(text);
    }
  }
  const uniq = [...new Set(found)];
  return { raw: uniq[0] || null, all: uniq };
}

async function probeUrl(url) {
  if (!url || !/^https?:\/\//i.test(url)) return { ok: false, error: "no url" };
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": UA, "Accept-Language": "en-GB,en;q=0.9" },
      redirect: "follow",
    });
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
    const html = await res.text();
    const hints = extractMintageHintsFromHtml(html);
    return { ok: true, httpStatus: res.status, pageMintageHint: hints.raw, pageMintageHints: hints.all };
  } catch (e) {
    return { ok: false, error: String(e.message || e) };
  }
}

async function main() {
  const doProbe = process.argv.includes("--probe");
  const limitIdx = process.argv.indexOf("--limit");
  const probeLimit = limitIdx !== -1 && process.argv[limitIdx + 1] ? parseInt(process.argv[limitIdx + 1], 10) : 80;

  const conn = await mysql.createConnection(getConfig());
  let rows;
  try {
    const [r] = await conn.execute(
      `SELECT id, title, title_en, country, catalog_number, catalog_suffix,
              mintage, mintage_display, mint, mint_short, source_url, release_date
       FROM coins
       WHERE (mintage IS NULL OR mintage = 0)
         AND (mintage_display IS NULL OR TRIM(mintage_display) = '')
       ORDER BY country, mint, id`
    );
    rows = r;
  } finally {
    await conn.end();
  }

  console.log("Монет без числового тиража и без mintage_display:", rows.length);

  const withUrl = rows.filter((x) => x.source_url && String(x.source_url).trim().startsWith("http"));
  console.log("Из них с заполненным source_url:", withUrl.length);

  let probed = 0;
  const enriched = [];

  for (const row of rows) {
    const item = { ...row };
    const url = row.source_url && String(row.source_url).trim();

    if (doProbe && url && /^https?:\/\//i.test(url)) {
      if (probed >= probeLimit) {
        item.pageProbe = { skipped: true, reason: "достигнут --limit" };
      } else {
        const host = (() => {
          try {
            return new URL(url).hostname;
          } catch {
            return "";
          }
        })();
        if (/royalmint\.com|perthmint\.com/i.test(host)) {
          process.stdout.write(`  probe ${row.id} ${host}… `);
          const p = await probeUrl(url);
          probed++;
          item.pageProbe = p;
          console.log(p.ok ? (p.pageMintageHint || "(mintage в HTML не найден)") : p.error);
          await sleep(400);
        } else {
          item.pageProbe = { skipped: true, reason: "не Royal Mint / Perth (нет типового HTML)" };
        }
      }
    }

    enriched.push(item);
  }

  if (doProbe && withUrl.length > probeLimit) {
    console.log("\nОграничение --limit:", probeLimit, "— остальные строки без HTTP-запроса.");
  }

  const summary = {
    generatedAt: new Date().toISOString(),
    criteria:
      "(mintage IS NULL OR mintage = 0) AND (mintage_display пустой) — в БД нет ни числа, ни текстового тиража",
    total: enriched.length,
    withSourceUrl: withUrl.length,
    probedHttp: doProbe ? probed : 0,
    foundHintOnPage: enriched.filter((x) => x.pageProbe && x.pageProbe.pageMintageHint).length,
    rows: enriched,
  };

  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(OUT_JSON, JSON.stringify(summary, null, 2), "utf8");
  console.log("\nФайл отчёта:", OUT_JSON);
  console.log(
    "Подсказка с страницы (Mintage в HTML):",
    summary.foundHintOnPage,
    "из",
    doProbe ? probed : 0,
    "запросов"
  );
  console.log("\nДальше: вручную обновить coins.mintage / mintage_display или переспарсить (royal-mint:fetch-test, perth:fetch).");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
