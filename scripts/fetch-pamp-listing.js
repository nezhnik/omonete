/**
 * Сбор URL карточек с PAMP collectibles:
 * https://www.pamp.com/collections/collectibles
 *
 * Логика:
 * - открываем страницу;
 * - кликаем show-more до конца;
 * - читаем ссылки из .catalog-list;
 * - сохраняем список URL и snapshot.
 */
const fs = require("fs");
const path = require("path");

const LISTING_URL = "https://www.pamp.com/collections/collectibles";
const URL_LIST_FILE = path.join(__dirname, "pamp-collectibles-urls.txt");
const DATA_DIR = path.join(__dirname, "..", "data");
const PRODUCTS_JSON = path.join(DATA_DIR, "pamp-collectibles-listing-products.json");

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

async function clickCookie(page) {
  const sels = [
    "button#onetrust-accept-btn-handler",
    "button:has-text('Accept')",
    "button:has-text('I agree')",
    "button:has-text('Allow all')",
  ];
  for (const sel of sels) {
    const el = page.locator(sel).first();
    if (await el.isVisible().catch(() => false)) {
      await el.click({ timeout: 2000 }).catch(() => {});
      await page.waitForTimeout(500);
      return;
    }
  }
}

async function extractItems(page) {
  return page.evaluate(() => {
    const toAbs = (href) => {
      if (!href) return null;
      if (/^https?:\/\//i.test(href)) return href;
      if (href.startsWith("/")) return window.location.origin + href;
      return window.location.origin + "/" + href;
    };
    const out = [];
    const seen = new Set();
    const cards = document.querySelectorAll(".catalog-list a[href]");
    cards.forEach((a) => {
      const href = toAbs(a.getAttribute("href") || "");
      if (!href || seen.has(href)) return;
      if (!/\/collections\/collectibles\//i.test(href)) return;
      const title =
        (a.querySelector(".catalog-item__title")?.textContent || "").trim() ||
        (a.querySelector("img")?.getAttribute("alt") || "").trim() ||
        (a.textContent || "").trim() ||
        null;
      seen.add(href);
      out.push({ url: href, title });
    });
    return out;
  });
}

async function clickShowMore(page) {
  const sels = [
    ".show-more button",
    "button:has-text('SHOW MORE')",
    "button:has-text('Show more')",
  ];
  for (const sel of sels) {
    const btn = page.locator(sel).first();
    if (!(await btn.isVisible().catch(() => false))) continue;
    const disabled = await btn.isDisabled().catch(() => false);
    if (disabled) return false;
    await btn.click({ timeout: 3000 }).catch(() => {});
    return true;
  }
  return false;
}

async function main() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  const { chromium } = require("playwright-extra");
  const StealthPlugin = require("puppeteer-extra-plugin-stealth");
  chromium.use(StealthPlugin());
  const browser = await chromium.launch({ headless: process.env.HEADLESS !== "0", args: ["--no-sandbox"] });
  const context = await browser.newContext({
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    viewport: { width: 1366, height: 900 },
  });
  const page = await context.newPage();
  const gqlProducts = new Map();
  page.on("response", async (res) => {
    if (!/\/graphql$/i.test(res.url())) return;
    try {
      const req = res.request();
      const bodyRaw = req.postData() || "";
      const body = bodyRaw ? JSON.parse(bodyRaw) : null;
      const query = String(body?.query || "");
      if (!/productsByType|products\(type:\s*\"component_collectible\"/i.test(query)) return;
      const json = await res.json();
      const products = Array.isArray(json?.data?.products) ? json.data.products : [];
      for (const p of products) {
        const alias = String(p?.alias || "").trim();
        if (!alias) continue;
        const url = alias.startsWith("http") ? alias : `https://www.pamp.com${alias.startsWith("/") ? "" : "/"}${alias}`;
        const normalized = normalizeUrl(url);
        if (!normalized) continue;
        gqlProducts.set(normalized, { url: normalized, title: p?.title || null });
      }
    } catch {
      // ignore
    }
  });

  const byUrl = new Map();
  try {
    await page.goto(LISTING_URL, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForTimeout(1500);
    await clickCookie(page);
    await page.waitForTimeout(1000);

    for (let i = 0; i < 120; i++) {
      const items = await extractItems(page);
      for (const it of items) {
        const u = normalizeUrl(it.url);
        if (!u) continue;
        if (!byUrl.has(u)) byUrl.set(u, { url: u, title: it.title || null });
      }
      const clicked = await clickShowMore(page);
      if (!clicked) break;
      await page.waitForTimeout(1400);
    }
    await page.waitForTimeout(2000);
  } finally {
    await browser.close();
  }

  for (const [u, item] of gqlProducts.entries()) {
    if (!byUrl.has(u)) byUrl.set(u, item);
  }

  const products = Array.from(byUrl.values()).sort((a, b) => a.url.localeCompare(b.url));
  fs.writeFileSync(
    PRODUCTS_JSON,
    JSON.stringify({ source: LISTING_URL, updatedAt: new Date().toISOString(), products }, null, 2),
    "utf8"
  );
  fs.writeFileSync(URL_LIST_FILE, products.map((x) => x.url).join("\n") + (products.length ? "\n" : ""), "utf8");
  console.log("Собрано URL:", products.length);
  console.log("Список URL:", URL_LIST_FILE);
  console.log("Снимок:", PRODUCTS_JSON);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

