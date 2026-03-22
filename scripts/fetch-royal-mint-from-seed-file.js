/**
 * Читает URL страниц из scripts/royal-mint-seed-urls.txt, заходит на каждую,
 * собирает ссылки на товары (PLP или SS360) — как fetch-royal-mint-listing.js, но несколько стартовых URL подряд.
 *
 * Запуск из корня omonete-app:
 *   npm run royal-mint:listing:seed
 *   HEADLESS=0 npm run royal-mint:listing:seed
 *
 * Флаги (как у fetch-royal-mint-listing.js):
 *   --full          — не подмешивать прошлый прогресс seed-режима
 *   --write-full    — перезаписать royal-mint-urls.txt полным списком (все собранные URL)
 *   --keep-tube, --keep-best-value, --keep-graded-slab, --keep-coin-box
 *
 * Файл со списком стартов по умолчанию: scripts/royal-mint-seed-urls.txt
 * Другой файл: node scripts/fetch-royal-mint-from-seed-file.js --file path/to/urls.txt
 */
const fs = require("fs");
const path = require("path");
const { readSeedUrlsFromFile } = require("./royal-mint-seed-url-io.js");
const {
  collectRoyalMintListing,
  isSs360SearchUrl,
  getRoyalMintChromiumLaunchOptions,
  getRoyalMintBrowserContextOptions,
  applyRoyalMintPageHardening,
} = require("./royal-mint-listing-collect.js");

const DEFAULT_SEED_FILE = path.join(__dirname, "royal-mint-seed-urls.txt");
const URL_LIST_FILE = path.join(__dirname, "royal-mint-urls.txt");
const DATA_DIR = path.join(__dirname, "..", "data");
const PROGRESS_FILE = path.join(DATA_DIR, "royal-mint-listing-progress.json");
const PRODUCTS_JSON = path.join(DATA_DIR, "royal-mint-listing-products.json");

/** Ключ прогресса для режима «из файла» (отдельно от одного URL в fetch-royal-mint-listing.js). */
const SEED_PROGRESS_BASE = "__royal_mint_seed_urls_file__";

function loadSeedProgress() {
  if (!fs.existsSync(PROGRESS_FILE)) return null;
  try {
    const data = JSON.parse(fs.readFileSync(PROGRESS_FILE, "utf8"));
    if (data.listingBaseUrl === SEED_PROGRESS_BASE && Array.isArray(data.products)) return data;
  } catch {
    /* ignore */
  }
  return null;
}

function saveSeedProgress(products) {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(
    PROGRESS_FILE,
    JSON.stringify(
      {
        listingBaseUrl: SEED_PROGRESS_BASE,
        seedNote: "Прогресс режима fetch-royal-mint-from-seed-file.js",
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

  const fileIdx = process.argv.indexOf("--file");
  const seedPath = fileIdx !== -1 && process.argv[fileIdx + 1] ? process.argv[fileIdx + 1] : DEFAULT_SEED_FILE;
  const resolvedSeed = path.isAbsolute(seedPath) ? seedPath : path.join(process.cwd(), seedPath);

  const seeds = readSeedUrlsFromFile(resolvedSeed);
  if (seeds.length === 0) {
    console.error(
      "В файле нет ни одного URL (строка должна начинаться с http, не с #).\nФайл:",
      resolvedSeed
    );
    process.exit(1);
  }

  console.log("Файл стартовых URL:", resolvedSeed);
  console.log("Строк-URL:", seeds.length);

  const { chromium } = require("playwright");
  const browser = await chromium.launch(getRoyalMintChromiumLaunchOptions());
  const context = await browser.newContext(getRoyalMintBrowserContextOptions());
  const page = await context.newPage();
  await applyRoyalMintPageHardening(page);

  const byUrl = new Map();
  const runMeta = [];

  try {
    for (let i = 0; i < seeds.length; i++) {
      const listUrl = seeds[i];
      const ss360 = isSs360SearchUrl(listUrl);
      console.log(`\n[${i + 1}/${seeds.length}] Листинг:`, listUrl);

      const result = await collectRoyalMintListing(page, listUrl, {
        maxRounds: ss360 ? 130 : 90,
        stableNeeded: ss360 ? 8 : 6,
        pauseMs: ss360 ? 800 : undefined,
        skipTube: !keepTube,
        skipBestValue: !keepBestValue,
        skipGradedSlab: !keepGradedSlab,
        skipCoinBox: !keepCoinBox,
      });

      runMeta.push({
        listUrl,
        listingSource: result.listingSource || (ss360 ? "ss360" : "plp"),
        cardsInDom: result.cardsInDom,
        count: result.products.length,
      });

      for (const p of result.products) {
        if (p && p.url) byUrl.set(p.url, p);
      }

      if (ss360 && result.cardsInDom === 0 && result.products.length === 0) {
        console.warn(
          "SS360: 0 карточек для этого URL. Попробуй HEADLESS=0 или другую страницу (например PLP gold-coins)."
        );
      }
    }
  } finally {
    await browser.close();
  }

  let products = [...byUrl.values()];

  if (!full) {
    const prev = loadSeedProgress();
    if (prev && Array.isArray(prev.products) && prev.products.length > 0) {
      const m = new Map(prev.products.map((p) => [p.url, p]));
      for (const p of products) {
        if (!m.has(p.url)) m.set(p.url, p);
      }
      products = [...m.values()];
      console.log("\nСмержено с прошлым прогрессом seed-режима, всего уникальных URL:", products.length);
    }
  } else {
    console.log("\nРежим --full: прошлый seed-прогресс не подмешиваем.");
  }

  products.sort((a, b) => a.url.localeCompare(b.url));
  saveSeedProgress(products);

  fs.writeFileSync(
    PRODUCTS_JSON,
    JSON.stringify(
      {
        source: "fetch-royal-mint-from-seed-file",
        seedFile: resolvedSeed,
        seeds,
        runs: runMeta,
        totalProducts: products.length,
        products,
      },
      null,
      2
    ),
    "utf8"
  );

  console.log("\nПрогресс:", PROGRESS_FILE);
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
  const block =
    "\n# fetch-royal-mint-from-seed-file.js " + new Date().toISOString() + "\n" + toAppend.join("\n") + "\n";
  fs.appendFileSync(URL_LIST_FILE, block, "utf8");
  console.log("Дописано в", URL_LIST_FILE, "новых URL:", toAppend.length);
}

if (require.main === module) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
