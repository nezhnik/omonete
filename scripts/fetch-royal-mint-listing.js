/**
 * Сбор ссылок на товары с листинга The Royal Mint (аналог fetch-perth-mint-listing.js).
 *
 * Вёрстка:
 *   — PLP: #productsView → .item-card / .product-card → a.asset[href]
 *   — Поиск SS360: #ss360-filtered-results → ul.ss360-list.ss360-grid.ss360-grid--lg > li (см. royal-mint-listing-collect.js)
 *
 * Листинг подгружается скроллом (infinite scroll) до стабильного числа карточек.
 *
 * Несколько стартовых URL из файла: npm run royal-mint:listing:seed (scripts/royal-mint-seed-urls.txt).
 *
 * Запуск (из корня omonete-app):
 *   node scripts/fetch-royal-mint-listing.js
 *   node scripts/fetch-royal-mint-listing.js "https://www.royalmint.com/invest/bullion/..."
 *   node scripts/fetch-royal-mint-listing.js --silver   — листинг серебра (готовый URL поиска silver + годы)
 *   node scripts/fetch-royal-mint-listing.js --full          — игнорировать прогресс
 *   node scripts/fetch-royal-mint-listing.js --write-full    — перезаписать royal-mint-urls.txt целиком
 *   node scripts/fetch-royal-mint-listing.js --keep-tube          — не отфильтровывать «Tube» в названии
 *   node scripts/fetch-royal-mint-listing.js --keep-best-value    — не отфильтровывать «The Best Value» в названии
 *   node scripts/fetch-royal-mint-listing.js --keep-graded-slab   — не отфильтровывать NGC/PCGS graded в названии
 *   node scripts/fetch-royal-mint-listing.js --keep-coin-box      — не отфильтровывать «Coin Box» в названии
 *
 * Выход:
 *   scripts/royal-mint-urls.txt — по одному URL на строку
 *   data/royal-mint-listing-progress.json — прогресс + полный список с метаданными
 *   data/royal-mint-listing-products.json — снимок последнего сбора (удобно смотреть SKU/цену)
 */
const fs = require("fs");
const path = require("path");
const {
  collectRoyalMintListing,
  DEFAULT_GOLD_BULLION_LIST_URL,
  DEFAULT_SILVER_SEARCH_URL,
  isSs360SearchUrl,
  getRoyalMintChromiumLaunchOptions,
  getRoyalMintBrowserContextOptions,
  applyRoyalMintPageHardening,
} = require("./royal-mint-listing-collect.js");

const URL_LIST_FILE = path.join(__dirname, "royal-mint-urls.txt");
const DATA_DIR = path.join(__dirname, "..", "data");
const PROGRESS_FILE = path.join(DATA_DIR, "royal-mint-listing-progress.json");
const PRODUCTS_JSON = path.join(DATA_DIR, "royal-mint-listing-products.json");

function baseListingUrl(url) {
  try {
    const u = new URL(url);
    if (/\/search-results-page/i.test(u.pathname) || u.searchParams.has("ss360Query")) {
      return url.split("#")[0];
    }
    u.search = "";
    return u.toString().replace(/\/$/, "") || url;
  } catch {
    return url;
  }
}

function loadProgress(baseUrl) {
  if (!fs.existsSync(PROGRESS_FILE)) return null;
  try {
    const data = JSON.parse(fs.readFileSync(PROGRESS_FILE, "utf8"));
    if (data.listingBaseUrl === baseUrl && Array.isArray(data.products)) return data;
  } catch {
    /* ignore */
  }
  return null;
}

function saveProgress(baseUrl, products) {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(
    PROGRESS_FILE,
    JSON.stringify(
      {
        listingBaseUrl: baseUrl,
        products,
        updatedAt: new Date().toISOString(),
      },
      null,
      2
    ),
    "utf8"
  );
}

async function main() {
  const full = process.argv.includes("--full");
  const writeFull = process.argv.includes("--write-full");
  const keepTube = process.argv.includes("--keep-tube");
  const keepBestValue = process.argv.includes("--keep-best-value");
  const keepGradedSlab = process.argv.includes("--keep-graded-slab");
  const keepCoinBox = process.argv.includes("--keep-coin-box");
  const silver = process.argv.includes("--silver");
  const urlArg = process.argv.find((a) => a.startsWith("http"));
  const listUrl = urlArg || (silver ? DEFAULT_SILVER_SEARCH_URL : DEFAULT_GOLD_BULLION_LIST_URL);
  const baseUrl = baseListingUrl(listUrl);

  const { chromium } = require("playwright");
  const browser = await chromium.launch(getRoyalMintChromiumLaunchOptions());
  const context = await browser.newContext(getRoyalMintBrowserContextOptions());
  const page = await context.newPage();
  await applyRoyalMintPageHardening(page);

  let products;
  let cardsInDom;
  let listingSource = "plp";
  try {
    const ss360 = isSs360SearchUrl(listUrl);
    const result = await collectRoyalMintListing(page, listUrl, {
      maxRounds: ss360 ? 130 : 90,
      stableNeeded: ss360 ? 8 : 6,
      pauseMs: ss360 ? 800 : undefined,
      skipTube: !keepTube,
      skipBestValue: !keepBestValue,
      skipGradedSlab: !keepGradedSlab,
      skipCoinBox: !keepCoinBox,
    });
    cardsInDom = result.cardsInDom;
    products = result.products;
    listingSource = result.listingSource || (ss360 ? "ss360" : "plp");
  } finally {
    await browser.close();
  }

  console.log("Листинг:", listUrl);
  console.log("Источник:", listingSource === "ss360" ? "Site Search 360 (search-results-page)" : "PLP (#productsView)");
  console.log("Карточек в DOM (после скролла):", cardsInDom);
  const filterNote = [];
  if (!keepTube) filterNote.push("без Tube");
  if (!keepBestValue) filterNote.push('без «The Best Value»');
  if (!keepGradedSlab) filterNote.push("без NGC/PCGS graded");
  if (!keepCoinBox) filterNote.push("без Coin Box");
  console.log("Уникальных товаров" + (filterNote.length ? " (" + filterNote.join(", ") + ")" : "") + ":", products.length);

  if (listingSource === "ss360" && cardsInDom === 0 && products.length === 0) {
    console.warn(
      "SS360: результатов нет (0 карточек). Часто из‑за гео/бота: откройте URL в браузере или запустите HEADLESS=0 npm run royal-mint:listing:silver"
    );
  }

  if (!full) {
    const prev = loadProgress(baseUrl);
    if (prev && Array.isArray(prev.products) && prev.products.length > 0) {
      const byUrl = new Map(prev.products.map((p) => [p.url, p]));
      for (const p of products) {
        if (!byUrl.has(p.url)) byUrl.set(p.url, p);
      }
      products = [...byUrl.values()];
      console.log("Смержено с прогрессом, всего уникальных URL:", products.length);
    }
  } else {
    console.log("Режим --full: прогресс не подмешиваем.");
  }

  products.sort((a, b) => a.url.localeCompare(b.url));
  saveProgress(baseUrl, products);
  fs.writeFileSync(
    PRODUCTS_JSON,
    JSON.stringify({ listUrl, listingSource, cardsInDom, products }, null, 2),
    "utf8"
  );
  console.log("Прогресс:", PROGRESS_FILE);
  console.log("Снимок:", PRODUCTS_JSON);

  const urls = products.map((p) => p.url).filter(Boolean);
  if (urls.length === 0) {
    console.log("Нет ссылок для записи.");
    return;
  }

  if (writeFull) {
    fs.writeFileSync(URL_LIST_FILE, urls.join("\n") + "\n", "utf8");
    console.log("Перезаписан", URL_LIST_FILE, "— строк:", urls.length);
    return;
  }

  let existing = new Set();
  if (fs.existsSync(URL_LIST_FILE)) {
    existing = new Set(
      fs
        .readFileSync(URL_LIST_FILE, "utf8")
        .split(/\r?\n/)
        .map((s) => s.trim())
        .filter((s) => s.startsWith("http"))
    );
  }
  const toAppend = urls.filter((u) => !existing.has(u));
  if (toAppend.length === 0) {
    console.log("Все URL уже есть в", URL_LIST_FILE);
    return;
  }
  const block = "\n# fetch-royal-mint-listing.js " + new Date().toISOString() + "\n" + toAppend.join("\n") + "\n";
  fs.appendFileSync(URL_LIST_FILE, block, "utf8");
  console.log("Дописано в", URL_LIST_FILE, "новых URL:", toAppend.length);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
