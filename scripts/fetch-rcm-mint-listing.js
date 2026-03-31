/**
 * Сбор ссылок на товары (PDP) Royal Canadian Mint с категорий shop.
 * Пропускает рекламные вставки .block.containerblock внутри .js-product-list.products.row.
 * Собирает URL со всех страниц листинга через ?productPage=2,3,… В HTML страницы попадают все
 * карточки до текущей страницы (по DOM видно только часть — извлекаем из document, а не только из детей grid).
 *
 * Запуск (из корня omonete-app):
 *   node scripts/fetch-rcm-mint-listing.js
 *   node scripts/fetch-rcm-mint-listing.js --category=https://www.mint.ca/en/shop/categories/gold
 *   node scripts/fetch-rcm-mint-listing.js --dry-run   — только первая категория, без записи файлов
 *
 * Выход:
 *   data/rcm-mint-listing-urls.txt
 *   data/rcm-mint-listing-products.json  { updatedAt, categories: [{ url, productUrls[] }] }
 */
const fs = require("fs");
const path = require("path");
const {
  canonicalMintCaProductUrl,
  extractMintCaCoinPathsFromListingHtml,
} = require("./rcm-mint-lib.js");

const DATA_DIR = path.join(__dirname, "..", "data");
const URLS_TXT = path.join(DATA_DIR, "rcm-mint-listing-urls.txt");
const PRODUCTS_JSON = path.join(DATA_DIR, "rcm-mint-listing-products.json");

const DEFAULT_CATEGORIES = [
  "https://www.mint.ca/en/shop/categories/silver",
  "https://www.mint.ca/en/shop/categories/gold",
  "https://www.mint.ca/en/shop/categories/international-coins",
  "https://www.mint.ca/en/shop/categories/circulation",
];

async function dismissOverlays(page) {
  const selectors = [
    "button#onetrust-accept-btn-handler",
    "button[aria-label*='Accept']",
    "button:has-text('Accept All')",
  ];
  for (const sel of selectors) {
    const loc = page.locator(sel).first();
    if (await loc.isVisible().catch(() => false)) {
      await loc.click({ timeout: 2000 }).catch(() => {});
      await page.waitForTimeout(400);
      break;
    }
  }
}

function listingPageUrl(categoryBase, productPage) {
  const u = new URL(categoryBase);
  if (productPage <= 1) u.searchParams.delete("productPage");
  else u.searchParams.set("productPage", String(productPage));
  return u.toString();
}

/** Листинг mint.ca: в HTML копятся карточки по страницам (?productPage=N), видимых в DOM только 6 — обходим по полному document. */
async function collectCategory(page, categoryUrl, maxPages = 80) {
  const base = categoryUrl.replace(/#.*$/, "");
  const seen = new Set();
  let noGrowth = 0;

  for (let p = 1; p <= maxPages; p++) {
    const url = listingPageUrl(base, p);
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 120000 });
    await page.waitForTimeout(2000);
    await dismissOverlays(page);
    const html = await page.content();
    const before = seen.size;
    for (const path of extractMintCaCoinPathsFromListingHtml(html)) {
      const full = `https://www.mint.ca${path.startsWith("/") ? "" : "/"}${path}`;
      const c = canonicalMintCaProductUrl(full);
      if (c) seen.add(c);
    }
    if (seen.size === before) {
      noGrowth++;
      if (noGrowth >= 2) break;
    } else noGrowth = 0;
  }

  return { categoryUrl: base, productUrls: Array.from(seen).sort(), debugNote: "html_productPage" };
}

async function main() {
  const dry = process.argv.includes("--dry-run");
  const catArg = process.argv.find((a) => a.startsWith("--category="));
  const urls = catArg ? [catArg.split("=")[1].trim()] : DEFAULT_CATEGORIES;

  const { chromium } = require("playwright");
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    locale: "en-CA",
  });
  const page = await context.newPage();

  const categories = [];
  const all = new Set();

  for (const u of urls) {
    console.log("Категория:", u);
    const block = await collectCategory(page, u);
    console.log("  товаров:", block.productUrls.length);
    categories.push(block);
    block.productUrls.forEach((x) => all.add(x));
    if (dry) break;
  }

  await browser.close();

  const merged = Array.from(all).sort();
  console.log("\nВсего уникальных PDP:", merged.length);

  if (!dry) {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(URLS_TXT, merged.join("\n") + "\n", "utf8");
    fs.writeFileSync(
      PRODUCTS_JSON,
      JSON.stringify({ updatedAt: new Date().toISOString(), categories }, null, 2),
      "utf8"
    );
    console.log("Записано:", URLS_TXT);
    console.log("Записано:", PRODUCTS_JSON);
  } else {
    console.log("(dry-run — файлы не писались)");
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
