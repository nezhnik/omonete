/**
 * Тест цепочки: страница поиска SS360 (silver + твои фильтры) → первая карточка после фильтров → парсинг PDP (fetch-royal-mint-coin-test.js).
 *
 * Запуск из корня omonete-app:
 *   node scripts/royal-mint-ss360-fetch-one-test.js
 *   node scripts/royal-mint-ss360-fetch-one-test.js "https://www.royalmint.com/search-results-page?..."
 *   node scripts/royal-mint-ss360-fetch-one-test.js --no-images
 *   node scripts/royal-mint-ss360-fetch-one-test.js --only-pdp "https://www.royalmint.com/..."
 *       — пропустить SS360 (если в headless 0 карточек): спарсить PDP по ссылке из браузера.
 *
 * Если в headless 0 результатов — HEADLESS=0 или ROYAL_MINT_CHROME_CHANNEL=1 (системный Chrome), либо --only-pdp.
 */
const path = require("path");
const { spawnSync } = require("child_process");
const {
  collectRoyalMintSs360Search,
  DEFAULT_SILVER_SEARCH_URL,
  getRoyalMintChromiumLaunchOptions,
  getRoyalMintBrowserContextOptions,
  applyRoyalMintPageHardening,
} = require("./royal-mint-listing-collect.js");

function runFetchPdp(pdpUrl, extraFlags) {
  const fetchScript = path.join(__dirname, "fetch-royal-mint-coin-test.js");
  const args = [fetchScript, pdpUrl, ...extraFlags];
  const run = spawnSync(process.execPath, args, {
    cwd: path.join(__dirname, ".."),
    stdio: "inherit",
    env: process.env,
  });
  process.exit(run.status !== null && run.status !== undefined ? run.status : 1);
}

async function main() {
  const onlyPdpIdx = process.argv.indexOf("--only-pdp");
  if (onlyPdpIdx !== -1) {
    const pdpUrl = process.argv[onlyPdpIdx + 1];
    if (!pdpUrl || !pdpUrl.startsWith("http")) {
      console.error("После --only-pdp укажите полный URL страницы товара.");
      process.exit(1);
    }
    const userFlags = process.argv.slice(2).filter((a, idx, arr) => {
      if (a === "--only-pdp") return false;
      if (idx > 0 && arr[idx - 1] === "--only-pdp") return false;
      if (a.startsWith("http")) return false;
      return true;
    });
    runFetchPdp(pdpUrl, userFlags);
    return;
  }

  const urlArg = process.argv.find((a) => a.startsWith("http"));
  const listUrl = urlArg || DEFAULT_SILVER_SEARCH_URL;
  const userFlags = process.argv.slice(2).filter((a) => !a.startsWith("http"));

  const { chromium } = require("playwright");
  const browser = await chromium.launch(getRoyalMintChromiumLaunchOptions());
  const context = await browser.newContext(getRoyalMintBrowserContextOptions());
  const page = await context.newPage();
  await applyRoyalMintPageHardening(page);

  let products;
  try {
    const r = await collectRoyalMintSs360Search(page, listUrl, {
      maxRounds: 70,
      stableNeeded: 6,
      pauseMs: 750,
    });
    products = r.products;
    console.log("SS360: карточек в DOM (raw)", r.cardsInDom, "→ после фильтров", products.length);
    if (products[0]) {
      console.log("Первая:", products[0].name?.slice(0, 80));
      console.log("URL:", products[0].url);
    }
  } finally {
    await browser.close();
  }

  if (!products || products.length === 0) {
    console.error(
      "Нет ссылок после фильтров. Попробуй: HEADLESS=0 или ROYAL_MINT_CHROME_CHANNEL=1 npm run royal-mint:ss360-one — либо --only-pdp <URL PDP>."
    );
    process.exit(1);
  }

  const firstUrl = products[0].url;
  runFetchPdp(firstUrl, userFlags);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
