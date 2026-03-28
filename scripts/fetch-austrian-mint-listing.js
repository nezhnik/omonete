/**
 * Сбор URL товаров Münze Österreich (EN): блок .article-list, ссылки на /en/products/{slug}.
 * Пагинации на листинге нет — карточки на странице сразу.
 *
 * Сохраняет:
 *   - data/austrian-mint-listing-products.json  [{ url, title, listing_url, listing_label }]
 *   - scripts/austrian-mint-urls.txt            (уникальные URL PDP)
 *
 * Запуск:
 *   npm run austrian-mint:listing
 *   node scripts/fetch-austrian-mint-listing.js [URL листинга] ["метка"] ...
 */
const fs = require("fs");
const path = require("path");

const SCRIPT_DIR = __dirname;
const DATA_DIR = path.join(SCRIPT_DIR, "..", "data");
const URL_LIST_FILE = path.join(SCRIPT_DIR, "austrian-mint-urls.txt");
const PRODUCTS_JSON = path.join(DATA_DIR, "austrian-mint-listing-products.json");

const DEFAULT_LISTINGS = [
  {
    url: "https://www.muenzeoesterreich.com/en/collect/collector-coins/gold-coins",
    label: "Collector coins — Gold",
  },
  {
    url: "https://www.muenzeoesterreich.com/en/collect/collector-coins/silver-coins",
    label: "Collector coins — Silver",
  },
  {
    url: "https://www.muenzeoesterreich.com/en/collect/collector-coins/copper-coins",
    label: "Collector coins — Copper",
  },
  {
    url: "https://www.muenzeoesterreich.com/en/collect/collector-coins/silver-niobium-coins",
    label: "Collector coins — Silver Niobium",
  },
];

function normalizeUrl(raw) {
  try {
    const u = new URL(raw);
    u.hash = "";
    u.pathname = u.pathname.replace(/\/\.\//g, "/").replace(/^\.\//, "/");
    return u.toString().replace(/\/$/, "");
  } catch {
    return null;
  }
}

function parseListingsFromArgv() {
  const args = process.argv.slice(2).filter((a) => !a.startsWith("--"));
  if (args.length === 0) return DEFAULT_LISTINGS.slice();
  const out = [];
  for (let i = 0; i < args.length; i++) {
    if (/^https?:\/\/www\.muenzeoesterreich\.com/i.test(args[i])) {
      const url = args[i];
      const label =
        args[i + 1] && !/^https?:\/\//i.test(args[i + 1]) ? args[++i] : "Custom listing";
      out.push({ url, label });
    }
  }
  return out.length ? out : DEFAULT_LISTINGS.slice();
}

async function main() {
  const listings = parseListingsFromArgv();

  const { chromium } = require("playwright-extra");
  const StealthPlugin = require("puppeteer-extra-plugin-stealth");
  chromium.use(StealthPlugin());
  const browser = await chromium.launch({ headless: process.env.HEADLESS !== "0", args: ["--no-sandbox"] });
  const context = await browser.newContext({
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    locale: "en-GB",
    viewport: { width: 1366, height: 900 },
  });
  const page = await context.newPage();

  const products = [];
  try {
    for (const listing of listings) {
      const listingUrl = normalizeUrl(listing.url);
      if (!listingUrl) continue;
      console.log("Листинг:", listing.label, listingUrl);
      await page.goto(listingUrl, { waitUntil: "networkidle", timeout: 120000 });
      await page.waitForSelector(".article-list", { timeout: 60000 }).catch(() => {});
      await page.waitForTimeout(500);

      const rows = await page.evaluate(() => {
        const root = document.querySelector(".article-list");
        if (!root) return [];
        const out = [];
        root.querySelectorAll('a[href*="/en/products/"]').forEach((a) => {
          let path = "";
          try {
            path = new URL(a.href).pathname.replace(/\/+$/, "") || "";
          } catch {
            return;
          }
          if (!/^\/en\/products\/[^/]+$/i.test(path)) return;
          const u = new URL(a.href).origin + path;
          const title =
            (a.getAttribute("title") || a.textContent || "")
              .replace(/\s+/g, " ")
              .trim() || null;
          out.push({ url: u, title });
        });
        return out;
      });

      const seenInPage = new Set();
      for (const row of rows) {
        const u = normalizeUrl(row.url);
        if (!u || seenInPage.has(u)) continue;
        seenInPage.add(u);
        products.push({
          url: u,
          title: row.title,
          listing_url: listingUrl,
          listing_label: listing.label,
        });
      }
      console.log("  карточек на странице:", seenInPage.size);
    }
  } finally {
    await browser.close();
  }

  const byUrl = new Map();
  for (const p of products) {
    if (!byUrl.has(p.url)) byUrl.set(p.url, p);
  }
  const unique = Array.from(byUrl.values());

  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(PRODUCTS_JSON, JSON.stringify(unique, null, 2), "utf8");
  fs.writeFileSync(
    URL_LIST_FILE,
    unique
      .map((p) => p.url)
      .sort()
      .join("\n") + "\n",
    "utf8"
  );

  console.log("Всего уникальных PDP:", unique.length);
  console.log("JSON:", PRODUCTS_JSON);
  console.log("URLs:", URL_LIST_FILE);
}

if (require.main === module) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}

module.exports = { DEFAULT_LISTINGS, normalizeUrl };
