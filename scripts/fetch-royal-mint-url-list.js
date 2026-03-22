/**
 * По списку URL из scripts/royal-mint-urls.txt последовательно запускает
 * fetch-royal-mint-coin-test.js (Playwright + JSON в data/ + webp).
 *
 * Сначала собери список:
 *   npm run royal-mint:listing:seed
 *   (или --write-full чтобы перезаписать royal-mint-urls.txt целиком)
 *
 * Запуск парсинга PDP:
 *   node scripts/fetch-royal-mint-url-list.js
 *   node scripts/fetch-royal-mint-url-list.js --limit 5
 *   node scripts/fetch-royal-mint-url-list.js --no-images
 *   node scripts/fetch-royal-mint-url-list.js --start 100   — пропустить первые 100 строк
 *   node scripts/fetch-royal-mint-url-list.js --concurrency 3
 *
 * Дальше: npm run royal-mint:import → npm run data:export → npm run build
 */
const fs = require("fs");
const path = require("path");
const { runRoyalMintFetchPool } = require("./royal-mint-fetch-pool.js");

const URL_LIST_FILE = path.join(__dirname, "royal-mint-urls.txt");
const FETCH_SCRIPT = path.join(__dirname, "fetch-royal-mint-coin-test.js");
const root = path.join(__dirname, "..");

function parseArgs() {
  const limitIdx = process.argv.indexOf("--limit");
  const startIdx = process.argv.indexOf("--start");
  const ci = process.argv.indexOf("--concurrency");
  const limit = limitIdx !== -1 && process.argv[limitIdx + 1] ? parseInt(process.argv[limitIdx + 1], 10) : 0;
  const start = startIdx !== -1 && process.argv[startIdx + 1] ? parseInt(process.argv[startIdx + 1], 10) : 0;
  const noImages = process.argv.includes("--no-images");
  let concurrency =
    ci >= 0 && process.argv[ci + 1] ? parseInt(process.argv[ci + 1], 10) : parseInt(process.env.ROYAL_MINT_FETCH_CONCURRENCY || "2", 10);
  if (!Number.isFinite(concurrency) || concurrency < 1) concurrency = 1;
  if (concurrency > 12) concurrency = 12;
  return {
    limit: Number.isFinite(limit) && limit > 0 ? limit : 0,
    start: Number.isFinite(start) && start > 0 ? start : 0,
    noImages,
    concurrency,
  };
}

function readUrls() {
  if (!fs.existsSync(URL_LIST_FILE)) {
    console.error("Нет файла:", URL_LIST_FILE);
    console.error("Сначала: npm run royal-mint:listing:seed");
    process.exit(1);
  }
  const lines = fs.readFileSync(URL_LIST_FILE, "utf8").split(/\r?\n/);
  const out = [];
  const seen = new Set();
  for (const line of lines) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const http = t.match(/https?:\/\/[^\s#]+/);
    if (!http) continue;
    let u = http[0].replace(/[,;)\]]+$/, "");
    if (!seen.has(u)) {
      seen.add(u);
      out.push(u);
    }
  }
  return out;
}

async function main() {
  const { limit, start, noImages, concurrency } = parseArgs();
  let urls = readUrls();
  if (start > 0) urls = urls.slice(start);
  if (limit > 0) urls = urls.slice(0, limit);

  console.log("Файл:", URL_LIST_FILE);
  console.log(
    "К парсингу URL:",
    urls.length,
    start ? `(start ${start})` : "",
    limit ? `(limit ${limit})` : "",
    `(параллельность ${concurrency})`
  );

  const { success, fail } = await runRoyalMintFetchPool({
    urls,
    root,
    fetchScript: FETCH_SCRIPT,
    noImages,
    concurrency,
  });

  console.log("\nГотово. Успех:", success, "ошибок:", fail);
  console.log("Импорт в БД: npm run royal-mint:import");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
