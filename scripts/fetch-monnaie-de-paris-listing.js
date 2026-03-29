/**
 * Сбор URL карточек Monnaie de Paris (Magento): листинг монет.
 *
 * Листинг: ol.products.list.items.product-items → li.product-item,
 * ссылка a.product-item-link[href], серия часто в title ссылки, название — .product-item-name + подзаголовок.
 * Пагинация: нижний .toolbar.toolbar-products (#toolbar-bottom) — ul.pages-items a.action.next или ?p=N.
 *
 * Сохраняет:
 *   data/monnaie-de-paris-listing-products.json  [{ url, title, series_title, sku, listing_url, listing_label }]
 *   scripts/monnaie-de-paris-urls.txt
 *   data/monnaie-de-paris-listing-progress.ndjson  — после каждой страницы: номер стр., сколько уникальных URL (история, порядок обхода)
 *
 * Запуск:
 *   npm run mdp:listing
 *   node scripts/fetch-monnaie-de-paris-listing.js "https://www.monnaiedeparis.fr/en/coins/year-date-2026" "Year 2026"
 *
 * Опции:
 *   --max-pages=5   — только первые N страниц листинга (проверка)
 *
 * Навигация: scripts/mdp-nav-options.js (env MDP_GOTO_* , MDP_LISTING_GRID_MS).
 */
const fs = require("fs");
const path = require("path");
const {
  mdpPageGotoOptions,
  mdpPostNavigationLoadState,
  mdpListingGridTimeoutMs,
} = require("./mdp-nav-options.js");

const SCRIPT_DIR = __dirname;
const DATA_DIR = path.join(SCRIPT_DIR, "..", "data");
const DEFAULT_LISTING = {
  url: "https://www.monnaiedeparis.fr/en/coins",
  label: "Coins (en)",
};
const PRODUCTS_JSON = path.join(DATA_DIR, "monnaie-de-paris-listing-products.json");
const URL_LIST_FILE = path.join(SCRIPT_DIR, "monnaie-de-paris-urls.txt");
const LISTING_PROGRESS_NDJSON = path.join(DATA_DIR, "monnaie-de-paris-listing-progress.ndjson");

function normalizeUrl(raw) {
  try {
    const u = new URL(raw);
    if (!/\.monnaiedeparis\.fr$/i.test(u.hostname)) return null;
    u.hash = "";
    const skip =
      /\/(checkout|customer|wishlist|cart)(\/|$)/i.test(u.pathname) ||
      /^\/en\/?$/i.test(u.pathname);
    if (skip) return null;
    return u.toString().replace(/\/$/, "");
  } catch {
    return null;
  }
}

function parseListingsFromArgv() {
  const args = process.argv.slice(2).filter((a) => !a.startsWith("--"));
  if (args.length === 0) return [DEFAULT_LISTING];
  const out = [];
  for (let i = 0; i < args.length; i++) {
    if (/^https?:\/\/www\.monnaiedeparis\.fr/i.test(args[i])) {
      const url = args[i];
      const label =
        args[i + 1] && !/^https?:\/\//i.test(args[i + 1]) ? args[++i] : "Custom listing";
      out.push({ url, label });
    }
  }
  return out.length ? out : [DEFAULT_LISTING];
}

async function acceptCookies(page) {
  const sels = [
    "button#onetrust-accept-btn-handler",
    "button:has-text('Accept all')",
    "button:has-text('Accept All')",
    "button:has-text('I Accept')",
    "button:has-text('Tout accepter')",
  ];
  for (const sel of sels) {
    const el = page.locator(sel).first();
    if (await el.isVisible().catch(() => false)) {
      await el.click({ timeout: 3000 }).catch(() => {});
      await page.waitForTimeout(600);
      return;
    }
  }
}

async function waitForProductGrid(page) {
  await page.waitForSelector("ol.products.list.items.product-items li.product-item", {
    timeout: mdpListingGridTimeoutMs(),
  });
  await page.waitForLoadState(mdpPostNavigationLoadState()).catch(() => {});
  await page.waitForTimeout(400);
}

async function extractPageRows(page, listingUrl, listingLabel) {
  return page.evaluate(
    ({ listingUrlIn, listingLabelIn }) => {
      const text = (el) => (el && el.textContent ? el.textContent.replace(/\s+/g, " ").trim() : "");
      const toAbs = (href) => {
        if (!href) return null;
        const h = String(href).trim();
        if (/^javascript:/i.test(h) || h === "#") return null;
        if (/^https?:\/\//i.test(h)) return h.split("#")[0];
        if (h.startsWith("/")) return window.location.origin + h;
        return window.location.origin + "/" + h;
      };
      const root = document.querySelector("ol.products.list.items.product-items");
      if (!root) return [];
      const seen = new Set();
      const rows = [];
      root.querySelectorAll("li.item.product.product-item").forEach((li) => {
        const link = li.querySelector("a.product-item-link[href]");
        const raw = link ? link.getAttribute("href") : "";
        const abs = toAbs(raw);
        if (!abs || seen.has(abs)) return;
        try {
          const u = new URL(abs);
          if (!/monnaiedeparis\.fr/i.test(u.hostname)) return;
          if (/\/(checkout|customer|cart)\//i.test(u.pathname)) return;
        } catch {
          return;
        }
        seen.add(abs);
        const nameEl = li.querySelector("strong.product-item-name");
        const name = nameEl ? text(nameEl) : "";
        const sub = link ? text(link.querySelector(":scope > span")) : "";
        const title = [name, sub].filter(Boolean).join(" — ") || text(link) || null;
        const seriesTitle = link ? (link.getAttribute("title") || "").trim() || null : null;
        const skuEl = li.querySelector(".product-sku");
        const sku = skuEl ? text(skuEl) : null;
        rows.push({
          url: abs.replace(/\/$/, ""),
          title,
          series_title: seriesTitle,
          sku,
          listing_url: listingUrlIn,
          listing_label: listingLabelIn,
        });
      });
      return rows;
    },
    { listingUrlIn: listingUrl, listingLabelIn: listingLabel }
  );
}

async function goNextPage(page) {
  let next = page.locator("#toolbar-bottom li.pages-item-next a.action.next").first();
  if (!(await next.isVisible().catch(() => false))) {
    next = page.locator("li.pages-item-next a.action.next").first();
  }
  if (!(await next.isVisible().catch(() => false))) return false;
  const href = await next.getAttribute("href").catch(() => null);
  if (!href || href === "#") return false;
  const abs = href.startsWith("http") ? href : new URL(href, page.url()).toString();
  const before = await page
    .locator("ol.products.list.items.product-items li.product-item")
    .first()
    .locator("a.product-item-link")
    .first()
    .getAttribute("href")
    .catch(() => "");
  await next.click({ timeout: 10000 }).catch(() => {});
  await page.waitForLoadState(mdpPostNavigationLoadState()).catch(() => {});
  await waitForProductGrid(page).catch(() => {});
  let after = await page
    .locator("ol.products.list.items.product-items li.product-item")
    .first()
    .locator("a.product-item-link")
    .first()
    .getAttribute("href")
    .catch(() => "");
  if (after === before) {
    await page.goto(abs, mdpPageGotoOptions()).catch(() => {});
    await waitForProductGrid(page).catch(() => {});
    after = await page
      .locator("ol.products.list.items.product-items li.product-item")
      .first()
      .locator("a.product-item-link")
      .first()
      .getAttribute("href")
      .catch(() => "");
  }
  return after !== before;
}

function parseMaxPagesCli() {
  const raw = process.argv.find((a) => a.startsWith("--max-pages="));
  if (!raw) return null;
  const n = parseInt(raw.slice("--max-pages=".length), 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

async function scrapeOneListing(page, listing, maxPages, writeCheckpoint) {
  const { url: listingUrl, label: listingLabel } = listing;
  const all = [];
  const seenUrls = new Set();
  let guard = 0;

  await page.goto(listingUrl, mdpPageGotoOptions());
  await acceptCookies(page);
  await waitForProductGrid(page);

  while (guard < 500) {
    guard++;
    const batch = await extractPageRows(page, listingUrl, listingLabel);
    for (const row of batch) {
      const nu = normalizeUrl(row.url);
      if (!nu || seenUrls.has(nu)) continue;
      seenUrls.add(nu);
      all.push({ ...row, url: nu });
    }
    console.log(
      `  [${listingLabel}] стр. ${guard}, +${batch.length} на экране, всего уникальных: ${all.length}`
    );

    if (typeof writeCheckpoint === "function") {
      try {
        writeCheckpoint(all, guard, listingLabel);
      } catch (e) {
        console.warn("  [checkpoint] не записан:", e.message || e);
      }
    }

    if (maxPages != null && guard >= maxPages) {
      console.log(`  [${listingLabel}] стоп по --max-pages=${maxPages}`);
      break;
    }

    const moved = await goNextPage(page);
    if (!moved) break;
  }
  return all;
}

async function main() {
  const listings = parseListingsFromArgv();
  const maxPages = parseMaxPagesCli();
  if (maxPages) console.log("Режим --max-pages:", maxPages);
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

  const { chromium } = require("playwright-extra");
  const StealthPlugin = require("puppeteer-extra-plugin-stealth");
  chromium.use(StealthPlugin());
  const browser = await chromium.launch({ headless: process.env.HEADLESS !== "0", args: ["--no-sandbox"] });
  const context = await browser.newContext({
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    locale: "en-GB",
    viewport: { width: 1400, height: 900 },
  });
  const page = await context.newPage();

  const merged = [];
  const flushListingCheckpoint = (rows, pageNum, listingLabelForLog) => {
    const byUrl = new Map();
    for (const r of rows) {
      if (!byUrl.has(r.url)) byUrl.set(r.url, r);
    }
    const unique = Array.from(byUrl.values());
    fs.writeFileSync(PRODUCTS_JSON, JSON.stringify(unique, null, 2), "utf8");
    fs.writeFileSync(
      URL_LIST_FILE,
      unique.map((x) => x.url).join("\n") + "\n",
      "utf8"
    );
    if (pageNum != null && listingLabelForLog != null) {
      try {
        fs.appendFileSync(
          LISTING_PROGRESS_NDJSON,
          JSON.stringify({
            t: new Date().toISOString(),
            listing_label: listingLabelForLog,
            page: pageNum,
            unique_total: unique.length,
          }) + "\n",
          "utf8"
        );
      } catch (e) {
        console.warn("  [listing-progress] не записан:", e.message || e);
      }
    }
  };

  try {
    for (const listing of listings) {
      console.log("Листинг:", listing.label, listing.url);
      const rows = await scrapeOneListing(page, listing, maxPages, (pageRows, pageNum, listingLabelForLog) => {
        const combined = [...merged, ...pageRows];
        flushListingCheckpoint(combined, pageNum, listingLabelForLog);
      });
      merged.push(...rows);
      flushListingCheckpoint(merged, null, null);
    }
  } finally {
    await browser.close();
  }

  const byUrl = new Map();
  for (const r of merged) {
    if (!byUrl.has(r.url)) byUrl.set(r.url, r);
  }
  const unique = Array.from(byUrl.values());

  fs.writeFileSync(PRODUCTS_JSON, JSON.stringify(unique, null, 2), "utf8");
  fs.writeFileSync(
    URL_LIST_FILE,
    unique.map((x) => x.url).join("\n") + "\n",
    "utf8"
  );

  console.log("—");
  console.log("Уникальных URL:", unique.length);
  console.log("JSON:", PRODUCTS_JSON);
  console.log("Список URL:", URL_LIST_FILE);
  console.log("Далее: npm run mdp:fetch:all && npm run mdp:import && npm run data:export:incremental");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
