/**
 * Перекачивает карточки Scottsdale по source_url из БД (после правки парсера картинок).
 * Пишет data/scottsdale-mint-<slug>.json и файлы в public/image/... как fetch-scottsdale-product.
 *
 *   node scripts/refetch-scottsdale-from-db.js
 *   node scripts/refetch-scottsdale-from-db.js --limit=5
 */
require("dotenv").config({ path: ".env" });
const mysql = require("mysql2/promise");
const { chromium } = require("playwright-extra");
const StealthPlugin = require("puppeteer-extra-plugin-stealth");
const { fetchOneWithPage } = require("./fetch-scottsdale-product.js");

function getConfig() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL не задан");
  const m = url.match(/mysql:\/\/([^:]+):([^@]+)@([^:]+):(\d+)\/(.+)/);
  if (!m) throw new Error("Неверный формат DATABASE_URL");
  const [, user, password, host, port, database] = m;
  return { host, port: Number(port), user, password, database };
}

async function main() {
  const limitArg = process.argv.find((a) => a.startsWith("--limit="));
  const limit = limitArg ? Number(limitArg.split("=")[1]) : 0;

  const conn = await mysql.createConnection(getConfig());
  const [rows] = await conn.execute(
    `SELECT DISTINCT source_url FROM coins
     WHERE source_url IS NOT NULL AND source_url != ''
       AND (mint_short = 'Scottsdale Mint' OR mint = 'Scottsdale Mint' OR series = 'Scottsdale Mint')
     ORDER BY id`
  );
  await conn.end();

  let urls = rows.map((r) => String(r.source_url).trim()).filter(Boolean);
  if (limit > 0) urls = urls.slice(0, limit);
  if (!urls.length) {
    console.log("Нет source_url для Scottsdale.");
    return;
  }

  chromium.use(StealthPlugin());
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({
    locale: "en-US",
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  });

  let ok = 0;
  let fail = 0;
  for (let i = 0; i < urls.length; i++) {
    process.stdout.write(`\r[${i + 1}/${urls.length}] ${urls[i].slice(-50)}   `);
    try {
      const r = await fetchOneWithPage(page, urls[i]);
      if (r && r.skippedRandom) continue;
      ok++;
    } catch (e) {
      fail++;
      console.error("\n", e.message || e);
    }
  }
  await browser.close();
  console.log("\nГотово. ok:", ok, "fail:", fail);
  console.log("Дальше: node scripts/import-scottsdale-to-db.js && node scripts/export-coins-to-json.js");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
