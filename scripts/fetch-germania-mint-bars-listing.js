/**
 * Сбор ссылок слитков с Germania Mint: https://germaniamint.com/all-bars/
 *
 * Что делает:
 * - открывает листинг all-bars;
 * - догружает карточки кнопкой Load More;
 * - собирает URL карточек слитков;
 * - сохраняет:
 *   - scripts/germania-mint-bars-urls.txt
 *   - data/germania-mint-bars-listing-products.json
 *
 * Запуск:
 *   node scripts/fetch-germania-mint-bars-listing.js
 *   node scripts/fetch-germania-mint-bars-listing.js --full
 */
const fs = require("fs");
const path = require("path");

const DEFAULT_URL = "https://germaniamint.com/all-bars/";
const URL_LIST_FILE = path.join(__dirname, "germania-mint-bars-urls.txt");
const DATA_DIR = path.join(__dirname, "..", "data");
const PRODUCTS_JSON = path.join(DATA_DIR, "germania-mint-bars-listing-products.json");

function normalizeUrl(raw) {
  try {
    const u = new URL(raw);
    u.hash = "";
    u.search = "";
    return u.toString().replace(/\/$/, "");
  } catch {
    return null;
  }
}

async function closeCookie(page) {
  const cookieSelectors = [
    "button#onetrust-accept-btn-handler",
    "button[aria-label*='Accept']",
    "button:has-text('Accept')",
    "button:has-text('I agree')",
  ];
  for (const sel of cookieSelectors) {
    const btn = page.locator(sel).first();
    if (await btn.isVisible().catch(() => false)) {
      await btn.click({ timeout: 1500 }).catch(() => {});
      await page.waitForTimeout(500);
      return;
    }
  }
}

async function extractProducts(page) {
  return page.evaluate(() => {
    const toAbs = (href) => {
      if (!href) return null;
      if (href.startsWith("http")) return href;
      if (href.startsWith("/")) return window.location.origin + href;
      return window.location.origin + "/" + href;
    };

    const isBarUrl = (url) => {
      if (!url) return false;
      const u = url.toLowerCase();
      if (!u.startsWith("https://germaniamint.com")) return false;
      if (u.includes("/all-bars/")) {
        try {
          const parsed = new URL(url);
          const p = parsed.pathname.replace(/\/+$/, "");
          return p !== "/all-bars";
        } catch {
          return false;
        }
      }
      return /\/bars?\//.test(u) || /\/product\//.test(u);
    };

    const map = new Map();
    const wrappers = document.querySelectorAll(".coin-item-wrapper");
    wrappers.forEach((item) => {
      const linkEl = item.querySelector("a.coin-item[href], h2 a[href], a[href]");
      const raw = linkEl ? linkEl.getAttribute("href") || "" : "";
      const abs = toAbs(raw);
      if (!isBarUrl(abs)) return;
      const title =
        (item.querySelector("h2 a")?.textContent || "").trim() ||
        (linkEl?.getAttribute("title") || "").trim() ||
        (linkEl?.textContent || "").trim() ||
        null;
      if (!map.has(abs)) map.set(abs, { url: abs, title });
    });

    if (map.size === 0) {
      const anchors = document.querySelectorAll("a[href]");
      anchors.forEach((a) => {
        const abs = toAbs(a.getAttribute("href") || "");
        if (!isBarUrl(abs)) return;
        const title =
          (a.getAttribute("title") || "").trim() ||
          (a.textContent || "").trim() ||
          (a.querySelector("img")?.getAttribute("alt") || "").trim() ||
          null;
        if (!map.has(abs)) map.set(abs, { url: abs, title });
      });
    }

    return Array.from(map.values());
  });
}

async function extractPagingUrls(page) {
  const html = await page.content();
  const links = new Set();
  const re = /href="(https:\/\/germaniamint\.com\/all-bars\/\?pg=\d+)"/gi;
  let m;
  while ((m = re.exec(html))) links.add(m[1]);
  return Array.from(links);
}

async function main() {
  const targetUrl = process.argv.find((a) => a.startsWith("http")) || DEFAULT_URL;
  const full = process.argv.includes("--full");
  const { chromium } = require("playwright");

  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

  const browser = await chromium.launch({
    headless: process.env.HEADLESS !== "0",
    args: ["--no-sandbox"],
  });
  const context = await browser.newContext({
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    viewport: { width: 1366, height: 900 },
  });
  const page = await context.newPage();

  let products = [];
  try {
    await page.goto(targetUrl, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForTimeout(1500);
    await closeCookie(page);
    await page.waitForTimeout(1000);

    const pageUrls = [targetUrl, ...(await extractPagingUrls(page))];
    const uniqPageUrls = Array.from(new Set(pageUrls));
    const byUrl = new Map();

    for (let i = 0; i < uniqPageUrls.length; i++) {
      const listUrl = uniqPageUrls[i];
      await page.goto(listUrl, { waitUntil: "domcontentloaded", timeout: 60000 });
      await page.waitForTimeout(1000);
      const batch = await extractProducts(page);
      for (const item of batch) {
        if (!byUrl.has(item.url)) byUrl.set(item.url, item);
      }
      console.log(`[${i + 1}/${uniqPageUrls.length}] ${listUrl} -> ${batch.length} links`);
    }

    products = Array.from(byUrl.values());
  } finally {
    await browser.close();
  }

  const normalized = [];
  const seen = new Set();
  for (const p of products) {
    const url = normalizeUrl(p.url);
    if (!url || seen.has(url)) continue;
    seen.add(url);
    normalized.push({ url, title: p.title || null });
  }
  normalized.sort((a, b) => a.url.localeCompare(b.url));

  let merged = normalized;
  if (!full && fs.existsSync(PRODUCTS_JSON)) {
    try {
      const prev = JSON.parse(fs.readFileSync(PRODUCTS_JSON, "utf8"));
      if (Array.isArray(prev.products)) {
        const byUrl = new Map(prev.products.map((x) => [x.url, x]));
        for (const item of normalized) byUrl.set(item.url, item);
        merged = Array.from(byUrl.values()).sort((a, b) => a.url.localeCompare(b.url));
      }
    } catch {
      // ignore
    }
  }

  fs.writeFileSync(
    PRODUCTS_JSON,
    JSON.stringify(
      {
        source: targetUrl,
        updatedAt: new Date().toISOString(),
        products: merged,
      },
      null,
      2
    ),
    "utf8"
  );

  const urls = merged.map((x) => x.url);
  fs.writeFileSync(URL_LIST_FILE, urls.join("\n") + (urls.length ? "\n" : ""), "utf8");

  console.log("Собрано URL bars:", urls.length);
  console.log("Список URL:", URL_LIST_FILE);
  console.log("Снимок:", PRODUCTS_JSON);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

