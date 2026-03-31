/**
 * Листинг Swissmint: https://www.sondermuenze.ch/en/special-coins/
 *
 * Сохраняет:
 *   data/swissmint-listing-products.json
 *   scripts/swissmint-urls.txt
 */
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const DATA_DIR = path.join(ROOT, "data");
const OUT_JSON = path.join(DATA_DIR, "swissmint-listing-products.json");
const OUT_URLS = path.join(__dirname, "swissmint-urls.txt");

const DEFAULT_URL = "https://www.sondermuenze.ch/en/special-coins/";

function normalizeUrl(raw) {
  try {
    const u = new URL(raw);
    if (!/(sondermuenze\.ch|swissmintshop\.admin\.ch)$/i.test(u.hostname)) return null;
    u.hash = "";
    if (/sondermuenze\.ch$/i.test(u.hostname)) u.search = "";
    return `${u.origin}${u.pathname}`.replace(/\/+$/, "");
  } catch {
    return null;
  }
}

async function extractRows(page, listingUrl) {
  return page.evaluate((payload) => {
    const txt = (el) => (el && el.textContent ? el.textContent.replace(/\s+/g, " ").trim() : "");
    const toAbs = (href) => {
      if (!href) return null;
      if (/^https?:\/\//i.test(href)) return href;
      if (href.startsWith("/")) return location.origin + href;
      return null;
    };

    const out = [];
    const seen = new Set();
    const root =
      document.querySelector(".coins.row.center-xs") ||
      document.querySelector(".coins");
    if (!root) return out;

    const cards = root.querySelectorAll("article, .coin, .coin-item, .row");
    for (const card of cards) {
      const anchors = Array.from(card.querySelectorAll("a[href]"));
      let productUrl = null;
      for (const a of anchors) {
        const href = toAbs(a.getAttribute("href"));
        if (!href) continue;
        if (!/(sondermuenze\.ch|swissmintshop\.admin\.ch)/i.test(href)) continue;
        if (/sondermuenze\.ch/i.test(href) && /\/special-coins\/?$/i.test(href)) continue;
        productUrl = href;
        break;
      }
      if (!productUrl) continue;
      const nu = productUrl.split("#")[0].replace(/\/+$/, "");
      if (seen.has(nu)) continue;
      seen.add(nu);

      const title =
        txt(card.querySelector("h2, h3, .section__title, .coin__title")) ||
        txt(card.querySelector("a[href]")) ||
        null;
      const image =
        (card.querySelector("img[src]") && card.querySelector("img[src]").getAttribute("src")) || null;
      out.push({
        url: nu,
        title,
        image: image && image.startsWith("/") ? location.origin + image : image,
        listing_url: payload.listingUrl,
      });
    }
    return out;
  }, { listingUrl });
}

async function main() {
  const argUrl = process.argv.find((x) => x.startsWith("--url="));
  const listingUrl = argUrl ? argUrl.split("=").slice(1).join("=").trim() : DEFAULT_URL;

  const { chromium } = require("playwright-extra");
  const StealthPlugin = require("puppeteer-extra-plugin-stealth");
  chromium.use(StealthPlugin());
  const browser = await chromium.launch({ headless: process.env.HEADLESS !== "0", args: ["--no-sandbox"] });
  const context = await browser.newContext({
    locale: "en-US",
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    viewport: { width: 1366, height: 900 },
  });
  const page = await context.newPage();
  await page.goto(listingUrl, { waitUntil: "domcontentloaded", timeout: 120000 });
  await page.waitForTimeout(2000);
  const rows = await extractRows(page, listingUrl);
  await browser.close();

  const byUrl = new Map();
  for (const r of rows) {
    const nu = normalizeUrl(r.url);
    if (!nu) continue;
    if (!byUrl.has(nu)) byUrl.set(nu, { ...r, url: nu });
  }
  const items = Array.from(byUrl.values()).sort((a, b) => a.url.localeCompare(b.url));

  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(OUT_URLS, items.map((x) => x.url).join("\n") + "\n", "utf8");
  fs.writeFileSync(
    OUT_JSON,
    JSON.stringify(
      {
        updatedAt: new Date().toISOString(),
        listing_url: listingUrl,
        total: items.length,
        items,
      },
      null,
      2
    ),
    "utf8"
  );
  console.log("Готово. Найдено URL:", items.length);
  console.log("Файлы:", OUT_JSON, OUT_URLS);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

