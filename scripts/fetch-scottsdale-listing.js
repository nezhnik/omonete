/**
 * Сбор URL карточек Scottsdale Mint.
 *
 * По умолчанию использует URL из задачи (с фильтрами) и дожимает кнопку
 * ais-InfiniteHits-loadPrevious ais-InfiniteHits-loadBtn (Show more / Load previous).
 * Останавливается, когда кнопка исчезает/disabled или 3 клика подряд не дают новых URL.
 *
 * Выход:
 *   data/scottsdale-mint-listing-urls.txt
 *   data/scottsdale-mint-listing-products.json
 */
const fs = require("fs");
const path = require("path");

const DATA_DIR = path.join(__dirname, "..", "data");
const URLS_TXT = path.join(DATA_DIR, "scottsdale-mint-listing-urls.txt");
const PRODUCTS_JSON = path.join(DATA_DIR, "scottsdale-mint-listing-products.json");

const DEFAULT_URL =
  "https://www.scottsdalemint.com/shop/?scottsdale_prod_posts_product%5Bquery%5D=scottsdale&scottsdale_prod_posts_product%5BhitsPerPage%5D=36&scottsdale_prod_posts_product%5BrefinementList%5D%5Bmetal.en_US%5D%5B0%5D=Copper%20Colorized%20Round&scottsdale_prod_posts_product%5BrefinementList%5D%5Bmetal.en_US%5D%5B1%5D=Copper%20Round&scottsdale_prod_posts_product%5BrefinementList%5D%5Bmetal.en_US%5D%5B2%5D=Gold%20Bar&scottsdale_prod_posts_product%5BrefinementList%5D%5Bmetal.en_US%5D%5B3%5D=Gold%20Round&scottsdale_prod_posts_product%5BrefinementList%5D%5Bmetal.en_US%5D%5B4%5D=Gold%20Stacker%20Round&scottsdale_prod_posts_product%5BrefinementList%5D%5Bmetal.en_US%5D%5B5%5D=Silver%20Antiqued%20Round&scottsdale_prod_posts_product%5BrefinementList%5D%5Bmetal.en_US%5D%5B6%5D=Silver%20Bar&scottsdale_prod_posts_product%5BrefinementList%5D%5Bmetal.en_US%5D%5B7%5D=Silver%20Bar%20Color&scottsdale_prod_posts_product%5BrefinementList%5D%5Bmetal.en_US%5D%5B8%5D=Silver%20Cast%20Bar&scottsdale_prod_posts_product%5BrefinementList%5D%5Bmetal.en_US%5D%5B9%5D=Silver%20Coin&scottsdale_prod_posts_product%5BrefinementList%5D%5Bmetal.en_US%5D%5B10%5D=Silver%20Coin%20Color&scottsdale_prod_posts_product%5BrefinementList%5D%5Bmetal.en_US%5D%5B11%5D=Silver%20Colorized%20Bar&scottsdale_prod_posts_product%5BrefinementList%5D%5Bmetal.en_US%5D%5B12%5D=Silver%20Colorized%20Round&scottsdale_prod_posts_product%5BrefinementList%5D%5Bmetal.en_US%5D%5B13%5D=Silver%20Round&scottsdale_prod_posts_product%5BrefinementList%5D%5Bmetal.en_US%5D%5B14%5D=Silver%20Stacker%20Bar&scottsdale_prod_posts_product%5BrefinementList%5D%5Bmetal.en_US%5D%5B15%5D=Silver%20Stacker%20Round&scottsdale_prod_posts_product%5BrefinementList%5D%5Bmetal.en_US%5D%5B16%5D=Stacker&scottsdale_prod_posts_product%5BrefinementList%5D%5Bpost_status%5D%5B0%5D=publish&scottsdale_prod_posts_product%5BrefinementList%5D%5B_exclude_from_search%5D%5B0%5D=no&scottsdale_prod_posts_product%5Bpage%5D=3&scottsdale_prod_posts_product%5Btoggle%5D%5Bvisible%5D=true";

function canonical(url) {
  try {
    const u = new URL(url);
    u.hash = "";
    u.searchParams.delete("orderby");
    return `${u.origin}${u.pathname}`.replace(/\/+$/, "");
  } catch {
    return null;
  }
}

function shouldSkipByTitle(t) {
  const s = String(t || "").toLowerCase();
  if (!s) return false;
  return /\brandom\b|\bmystery\b|\bmixed lot\b|\bassorted\b|\bgrab bag\b/.test(s);
}

function shouldSkipByUrl(url) {
  const s = String(url || "").toLowerCase();
  return /\/product\/__trashed\/?$/.test(s);
}

async function extractItems(page) {
  return page.evaluate(() => {
    const out = [];
    const seen = new Set();
    const root = document.querySelector(".ais-InfiniteHits.product-cards") || document;
    const cards = root.querySelectorAll("a[href]");
    for (const a of cards) {
      const href = a.getAttribute("href") || "";
      if (!href) continue;
      let abs = null;
      if (/^https?:\/\//i.test(href)) abs = href;
      else if (href.startsWith("/")) abs = location.origin + href;
      if (!abs) continue;
      if (!/scottsdalemint\.com/i.test(abs)) continue;
      if (!/\/product\//i.test(abs)) continue;
      const title =
        (a.querySelector("h1,h2,h3,h4,.woocommerce-loop-product__title,.product-title")?.textContent || "")
          .replace(/\s+/g, " ")
          .trim() ||
        (a.textContent || "").replace(/\s+/g, " ").trim() ||
        null;
      const c = abs.split("#")[0].split("?")[0].replace(/\/+$/, "");
      if (!c || seen.has(c)) continue;
      seen.add(c);
      out.push({ url: c, title });
    }
    return out;
  });
}

async function clickLoadPrevious(page) {
  const sels = [
    ".ais-InfiniteHits-loadPrevious .ais-InfiniteHits-loadBtn",
    ".ais-InfiniteHits-loadBtn",
    "button.ais-InfiniteHits-loadBtn",
    "button:has-text('Show more')",
    "button:has-text('Load previous')",
    "button:has-text('Load more')",
  ];
  for (const sel of sels) {
    const btn = page.locator(sel).first();
    if (!(await btn.isVisible().catch(() => false))) continue;
    const disabled = await btn.isDisabled().catch(() => false);
    if (disabled) return false;
    await btn.click({ timeout: 6000 }).catch(() => {});
    return true;
  }
  return false;
}

async function main() {
  const arg = process.argv.find((a) => a.startsWith("--url="));
  const baseUrl = arg ? arg.split("=").slice(1).join("=").trim() : DEFAULT_URL;
  const dryRun = process.argv.includes("--dry-run");
  const maxClicksArg = process.argv.find((a) => a.startsWith("--max-clicks="));
  const maxClicks = maxClicksArg ? Number(maxClicksArg.split("=")[1]) : 120;

  const { chromium } = require("playwright-extra");
  const StealthPlugin = require("puppeteer-extra-plugin-stealth");
  chromium.use(StealthPlugin());
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({
    locale: "en-US",
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  });

  const byUrl = new Map();
  const pages = [];
  let noGrowth = 0;

  await page.goto(baseUrl, { waitUntil: "domcontentloaded", timeout: 120000 });
  await page.waitForTimeout(5000);

  for (let p = 1; p <= maxClicks; p++) {
    const items = await extractItems(page);

    const before = byUrl.size;
    for (const it of items) {
      const c = canonical(it.url);
      if (!c) continue;
      if (shouldSkipByUrl(c)) continue;
      if (shouldSkipByTitle(it.title)) continue;
      if (!byUrl.has(c)) byUrl.set(c, { url: c, title: it.title || null, page: p });
    }
    pages.push({ click: p, url: page.url(), found: items.length, keptCumulative: byUrl.size });
    const grew = byUrl.size > before;
    if (!grew) noGrowth += 1;
    else noGrowth = 0;
    process.stdout.write(`\r[step ${p}] found=${items.length} kept=${byUrl.size}   `);
    if (dryRun) break;
    const clicked = await clickLoadPrevious(page);
    if (!clicked || noGrowth >= 3) break;
    await page.waitForTimeout(2800);
  }

  await browser.close();
  const urls = Array.from(byUrl.keys()).sort();

  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(URLS_TXT, urls.join("\n") + "\n", "utf8");
  fs.writeFileSync(
    PRODUCTS_JSON,
    JSON.stringify(
      {
        updatedAt: new Date().toISOString(),
        baseUrl,
        total: urls.length,
        pages,
        items: Array.from(byUrl.values()),
      },
      null,
      2
    ),
    "utf8"
  );
  console.log(`\nГотово. URL: ${urls.length}`);
  console.log("Файлы:", URLS_TXT, PRODUCTS_JSON);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

