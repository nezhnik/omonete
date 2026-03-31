/**
 * Сбор URL карточек Royal Dutch Mint (Magento).
 *
 * Листинг:
 *   .products.wrapper .catalog-products .grid.products-grid (и fallback к ol.products)
 * Пагинация:
 *   .toolbar.toolbar-products (нижняя) -> a.action.next
 *
 * Выход:
 *   data/royaldutch-mint-listing-products.json
 *   scripts/royaldutch-mint-urls.txt
 */
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const DATA_DIR = path.join(ROOT, "data");
const PRODUCTS_JSON = path.join(DATA_DIR, "royaldutch-mint-listing-products.json");
const URLS_TXT = path.join(__dirname, "royaldutch-mint-urls.txt");

const DEFAULT_URL =
  "https://www.royaldutchmint.com/dutch-coins?ec_metaal=4775%2C4790%2C4826%2C4781%2C4922%2C8452%2C8517&product_list_order=price";

function normalizeUrl(raw) {
  try {
    const u = new URL(raw);
    if (!/royaldutchmint\.com$/i.test(u.hostname)) return null;
    u.hash = "";
    u.searchParams.delete("product_list_mode");
    return `${u.origin}${u.pathname}${u.search}`.replace(/\/+$/, "");
  } catch {
    return null;
  }
}

function isGradedTitle(title) {
  const s = String(title || "").toLowerCase();
  return /\bngc\b/.test(s) || /\b(ms|pf)\s*-?\d{2}\b/.test(s) || /\b(ms|pf)\d{2}\b/.test(s);
}

async function acceptCookies(page) {
  const sels = [
    "button:has-text('Accept')",
    "button:has-text('Allow all')",
    "button:has-text('I agree')",
    "button#onetrust-accept-btn-handler",
  ];
  for (const sel of sels) {
    const el = page.locator(sel).first();
    if (await el.isVisible().catch(() => false)) {
      await el.click({ timeout: 2500 }).catch(() => {});
      await page.waitForTimeout(500);
      break;
    }
  }
}

async function waitGrid(page) {
  await page
    .waitForSelector(
      ".products.wrapper .catalog-products .grid.products-grid .product-item, ol.products.list.items.product-items li.product-item",
      { timeout: 45000 }
    )
    .catch(() => {});
  await page.waitForTimeout(300);
}

async function extractRows(page, listingUrl) {
  return page.evaluate((payload) => {
    const toAbs = (href) => {
      if (!href) return null;
      if (/^https?:\/\//i.test(href)) return href;
      if (href.startsWith("/")) return window.location.origin + href;
      return null;
    };
    const txt = (el) => (el && el.textContent ? el.textContent.replace(/\s+/g, " ").trim() : "");
    const out = [];
    const seen = new Set();

    const roots = [
      ...document.querySelectorAll(".products.wrapper .catalog-products .grid.products-grid .product-item"),
      ...document.querySelectorAll("ol.products.list.items.product-items li.product-item"),
    ];
    for (const item of roots) {
      const a =
        item.querySelector("a.product-item-link[href]") ||
        item.querySelector("a[href*='/']") ||
        null;
      if (!a) continue;
      const abs = toAbs(a.getAttribute("href") || "");
      if (!abs) continue;
      if (!/royaldutchmint\.com/i.test(abs)) continue;
      if (/\/(customer|checkout|cart|wishlist|login)/i.test(abs)) continue;
      const key = abs.split("#")[0].split("?")[0].replace(/\/+$/, "");
      if (!key || seen.has(key)) continue;
      seen.add(key);
      const title =
        txt(item.querySelector(".product-item-name, .product.name.product-item-name")) ||
        txt(item.querySelector(".product-item-link")) ||
        txt(a) ||
        null;
      const price =
        txt(item.querySelector(".price")) ||
        txt(item.querySelector(".price-wrapper")) ||
        null;
      out.push({
        url: key,
        title,
        price_display: price,
        listing_url: payload.listingUrl,
      });
    }
    return out;
  }, { listingUrl });
}

function listingPageUrl(baseUrl, pageNum) {
  const u = new URL(baseUrl);
  if (pageNum <= 1) u.searchParams.delete("p");
  else u.searchParams.set("p", String(pageNum));
  return `${u.origin}${u.pathname}?${u.searchParams.toString()}`;
}

function parseMaxPages() {
  const raw = process.argv.find((a) => a.startsWith("--max-pages="));
  if (!raw) return null;
  const n = Number(raw.split("=")[1]);
  return Number.isFinite(n) && n > 0 ? n : null;
}

async function main() {
  const argUrl = process.argv.find((a) => a.startsWith("--url="));
  const listing = argUrl ? argUrl.split("=").slice(1).join("=").trim() : DEFAULT_URL;
  const maxPages = parseMaxPages();

  const { chromium } = require("playwright-extra");
  const StealthPlugin = require("puppeteer-extra-plugin-stealth");
  chromium.use(StealthPlugin());
  const browser = await chromium.launch({ headless: process.env.HEADLESS !== "0", args: ["--no-sandbox"] });
  const context = await browser.newContext({
    locale: "en-GB",
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    viewport: { width: 1400, height: 900 },
  });
  const page = await context.newPage();

  const rows = [];
  const byUrl = new Map();

  let noGrowth = 0;
  for (let p = 1; p <= 300; p++) {
    const pageUrl = listingPageUrl(listing, p);
    await page.goto(pageUrl, { waitUntil: "domcontentloaded", timeout: 120000 });
    if (p === 1) await acceptCookies(page);
    await waitGrid(page);
    const batch = await extractRows(page, listing);
    const before = byUrl.size;
    for (const r of batch) {
      const nu = normalizeUrl(r.url);
      if (!nu) continue;
      if (isGradedTitle(r.title)) continue;
      if (!byUrl.has(nu)) byUrl.set(nu, { ...r, url: nu });
    }
    rows.push({ page: p, found: batch.length, keptCumulative: byUrl.size, url: page.url() });
    process.stdout.write(`\r[page ${p}] found=${batch.length} kept=${byUrl.size}   `);
    if (maxPages != null && p >= maxPages) break;
    if (batch.length === 0) break;
    if (byUrl.size === before) noGrowth++;
    else noGrowth = 0;
    if (noGrowth >= 2) break;
  }

  await browser.close();

  const all = Array.from(byUrl.values()).sort((a, b) => a.url.localeCompare(b.url));
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(URLS_TXT, all.map((x) => x.url).join("\n") + "\n", "utf8");
  fs.writeFileSync(
    PRODUCTS_JSON,
    JSON.stringify(
      {
        updatedAt: new Date().toISOString(),
        listing_url: listing,
        total: all.length,
        pages: rows,
        items: all,
      },
      null,
      2
    ),
    "utf8"
  );
  console.log(`\nГотово. URL: ${all.length}`);
  console.log("Файлы:", PRODUCTS_JSON, URLS_TXT);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

