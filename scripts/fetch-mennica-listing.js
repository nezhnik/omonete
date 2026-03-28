/**
 * Сбор URL товаров Mennica Polska (WooCommerce): блок #display-products / .content-item-products,
 * пагинация .woocommerce-pagination.
 *
 * По умолчанию два листинга (как у PAMP — несколько тем):
 *   - collectible-products
 *   - gold bars: базовый URL категории (см. ниже про query)
 *
 * Сохраняет:
 *   - data/mennica-listing-products.json  [{ url, title, listing_url, listing_label }]
 *   - scripts/mennica-urls.txt             (уникальные URL товаров)
 *
 * Запуск:
 *   npm run mennica:listing
 *   node scripts/fetch-mennica-listing.js "https://inwestycje.mennica.com.pl/..." "Моя метка"
 *
 * По умолчанию снимается чекбокс «Only Available» (dostepne) для collectible (иначе меньше карточек).
 * Для gold bars фильтр не трогаем: на сайте по умолчанию dostepne + слайдер цены (как в UI при
 * `?_filter=dostepne&priceMin=220&priceMax=56475`), но тот же query на сервере часто отдаёт 404 —
 * поэтому открываем категорию без query.
 * Если в URL листинга есть _filter=dostepne — чекбокс тоже не снимаем.
 * Явно оставить «только доступные» для всех листингов: --only-available
 */
const fs = require("fs");
const path = require("path");
const { isExcludedMennicaProductUrl } = require("./mennica-excluded-product-urls.js");

const SCRIPT_DIR = __dirname;
const DATA_DIR = path.join(SCRIPT_DIR, "..", "data");
const URL_LIST_FILE = path.join(SCRIPT_DIR, "mennica-urls.txt");
const PRODUCTS_JSON = path.join(DATA_DIR, "mennica-listing-products.json");

const DEFAULT_LISTINGS = [
  {
    url: "https://inwestycje.mennica.com.pl/collectible-products/?priceMax=4690&priceMin=5&_filter=",
    label: "Collectible products",
  },
  {
    url: "https://inwestycje.mennica.com.pl/investment-products/gold-investment/gold-bars/",
    label: "Gold bars (available, default price range)",
    /** Не снимать dostepne; эквивалент страницы с ?_filter=dostepne&priceMin=220&priceMax=56475 (query даёт 404) */
    keepOnlyAvailableFilter: true,
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

/** Товары на Mennica — pretty permalinks (/slug/), без /product/. */
async function waitForListingGridReady(page, previousFirstThumbHref) {
  await page.waitForSelector("#display-products a.thumbnail-img[href]", { timeout: 90000 });
  if (previousFirstThumbHref) {
    await page.waitForFunction(
      (prev) => {
        const normPath = (h) => {
          if (!h) return "";
          try {
            const u = new URL(h, window.location.origin);
            return u.pathname.replace(/\/\.\//g, "/").replace(/\/+$/, "") || "";
          } catch {
            return String(h);
          }
        };
        const a = document.querySelector("#display-products a.thumbnail-img[href]");
        const cur = a && a.href ? normPath(a.href) : "";
        return cur && cur !== normPath(prev);
      },
      previousFirstThumbHref,
      { timeout: 60000 }
    );
  } else {
    await page
      .waitForFunction(
        () => {
          const loader = document.querySelector("#display-products .loader");
          if (loader && loader.offsetParent !== null) return false;
          return document.querySelectorAll("#display-products a.thumbnail-img[href]").length > 0;
        },
        { timeout: 90000 }
      )
      .catch(() => {});
  }
  await page.waitForTimeout(500);
}

function parseCliOptions() {
  return {
    /** true = не снимать «Only Available», оставить узкую выдачу (~126) */
    onlyAvailable: process.argv.includes("--only-available"),
  };
}

/** URL уже задаёт фильтр «доступные» — не снимать чекбокс, иначе расширится выдача. */
function listingUrlKeepsOnlyAvailableFilter(listingUrl) {
  try {
    const u = new URL(listingUrl);
    const f = u.searchParams.get("_filter");
    return f != null && /dostepne/i.test(String(f));
  } catch {
    return false;
  }
}

function parseListingsFromArgv() {
  const args = process.argv.slice(2).filter((a) => !a.startsWith("--"));
  if (args.length === 0) return DEFAULT_LISTINGS.slice();
  const out = [];
  for (let i = 0; i < args.length; i++) {
    if (/^https?:\/\/inwestycje\.mennica\.com\.pl/i.test(args[i])) {
      const url = args[i];
      const label =
        args[i + 1] && !/^https?:\/\//i.test(args[i + 1]) ? args[++i] : "Custom listing";
      out.push({
        url,
        label,
        keepOnlyAvailableFilter: listingUrlKeepsOnlyAvailableFilter(url),
      });
    }
  }
  return out.length ? out : DEFAULT_LISTINGS.map((x) => ({ ...x }));
}

/**
 * На листинге по умолчанию включён фильтр «Only Available» (input[data-productfilter=dostepne]).
 * Без снятия счётчик показывает меньше товаров, чем у пользователя без этого фильтра.
 */
async function turnOffOnlyAvailableFilter(page) {
  const beforeTxt = await page.evaluate(
    () => document.querySelector(".woocommerce-result-count")?.innerText || ""
  );
  const toggled = await page.evaluate(() => {
    const cb = document.querySelector('input[data-productfilter="dostepne"]');
    if (!cb || !cb.checked) return false;
    cb.click();
    return true;
  });
  if (!toggled) return;
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.waitForFunction(
    (prev) => {
      const t = document.querySelector(".woocommerce-result-count")?.innerText || "";
      return t && t !== prev;
    },
    beforeTxt,
    { timeout: 60000 }
  );
  await waitForListingGridReady(page, null);
}

async function acceptCookies(page) {
  const sels = [
    "button#onetrust-accept-btn-handler",
    "button:has-text('Accept')",
    "button:has-text('I agree')",
    "button:has-text('Akceptuję')",
  ];
  for (const sel of sels) {
    const el = page.locator(sel).first();
    if (await el.isVisible().catch(() => false)) {
      await el.click({ timeout: 2000 }).catch(() => {});
      await page.waitForTimeout(600);
      return;
    }
  }
}

async function extractProductsFromGrid(page, listingUrl, listingLabel) {
  return page.evaluate(
    ({ listingUrlIn, listingLabelIn }) => {
      const toAbs = (href) => {
        if (!href) return null;
        const h = String(href).trim();
        if (/^javascript:/i.test(h) || h === "#") return null;
        if (/^https?:\/\//i.test(h)) return h.split("#")[0];
        if (h.startsWith("/")) return window.location.origin + h;
        return window.location.origin + "/" + h;
      };
      const cleanProductUrl = (abs) => {
        if (!abs) return null;
        let u;
        try {
          u = new URL(abs);
        } catch {
          return null;
        }
        if (!/mennica\.com\.pl/i.test(u.hostname)) return null;
        const path = u.pathname.replace(/\/\.\//g, "/");
        const skip =
          /\/wp-admin\/|\/wp-json\/|\/cart\/|\/checkout\/|\/my-account\/|\/feed\/?$/i.test(path) ||
          /\/collectible-products\/?$/i.test(path) ||
          /\/investment-products\/?$/i.test(path) ||
          /page\/\d+\/?$/i.test(path);
        if (skip) return null;
        if (path.split("/").filter(Boolean).length < 1) return null;
        u.pathname = path;
        u.hash = "";
        u.search = "";
        return u.toString().replace(/\/$/, "");
      };
      const root =
        document.querySelector("#display-products") ||
        document.querySelector(".content-item-products") ||
        document.querySelector(".archive-products-content-inner");
      if (!root) return [];
      const seen = new Set();
      const rows = [];
      const items = root.querySelectorAll(".product-miniature-item");
      items.forEach((item) => {
        const thumb = item.querySelector("a.thumbnail-img[href]");
        const titleA = item.querySelector("a.title[href]");
        const raw = (thumb && thumb.getAttribute("href")) || (titleA && titleA.getAttribute("href")) || "";
        const abs0 = toAbs(raw);
        const abs = cleanProductUrl(abs0);
        if (!abs || seen.has(abs)) return;
        seen.add(abs);
        const title =
          (titleA && titleA.textContent ? titleA.textContent.replace(/\s+/g, " ").trim() : "") ||
          (thumb && thumb.querySelector("img")?.getAttribute("alt") || "").trim() ||
          null;
        rows.push({
          url: abs,
          title: title || null,
          listing_url: listingUrlIn,
          listing_label: listingLabelIn,
        });
      });
      return rows;
    },
    { listingUrlIn: listingUrl, listingLabelIn: listingLabel }
  );
}

async function clickNextPage(page) {
  const loc = page.locator("a.next.page-numbers, .woocommerce-pagination a.next").first();
  if (!(await loc.isVisible().catch(() => false))) return false;
  const cls = (await loc.getAttribute("class").catch(() => "")) || "";
  if (/\bdisabled\b/.test(cls)) return false;
  const firstThumb = await page
    .locator("#display-products a.thumbnail-img")
    .first()
    .evaluate((el) => el.href)
    .catch(() => null);
  await loc.click({ timeout: 8000 }).catch(() => {});
  await page.waitForLoadState("networkidle").catch(() => {});
  await waitForListingGridReady(page, firstThumb);
  return true;
}

async function scrapeOneListing(page, listing, cli) {
  const listingUrl = listing.url;
  const listingLabel = listing.label;
  const all = [];
  const seenPages = new Set();
  let guard = 0;
  await page.goto(listingUrl, { waitUntil: "networkidle", timeout: 120000 });
  await acceptCookies(page);
  await waitForListingGridReady(page, null);
  const keepAvailableFilter =
    cli.onlyAvailable ||
    listingUrlKeepsOnlyAvailableFilter(listingUrl) ||
    listing.keepOnlyAvailableFilter === true;
  if (!keepAvailableFilter) {
    await turnOffOnlyAvailableFilter(page);
    const hint = await page.evaluate(
      () => document.querySelector(".woocommerce-result-count")?.innerText?.replace(/\s+/g, " ").trim() || ""
    );
    if (hint) console.log(`  [${listingLabel}] после снятия «Only Available»: ${hint}`);
  }

  while (guard < 200) {
    guard++;
    const u = page.url();
    if (seenPages.has(u)) break;
    seenPages.add(u);

    const batch = await extractProductsFromGrid(page, listingUrl, listingLabel);
    for (const row of batch) {
      const nu = normalizeUrl(row.url);
      if (nu && !all.some((x) => x.url === nu)) all.push({ ...row, url: nu });
    }
    console.log(`  [${listingLabel}] страница ${guard}, +${batch.length} карточек на экране, всего уникальных: ${all.length}`);

    const moved = await clickNextPage(page);
    if (!moved) break;
  }
  return all;
}

async function main() {
  const cli = parseCliOptions();
  const listings = parseListingsFromArgv();
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

  const { chromium } = require("playwright-extra");
  const StealthPlugin = require("puppeteer-extra-plugin-stealth");
  chromium.use(StealthPlugin());
  const browser = await chromium.launch({ headless: process.env.HEADLESS !== "0", args: ["--no-sandbox"] });
  const context = await browser.newContext({
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    locale: "en-GB",
    viewport: { width: 1400, height: 900 },
  });
  const page = await context.newPage();

  const merged = [];
  try {
    for (const listing of listings) {
      console.log("Листинг:", listing.label, listing.url);
      const rows = await scrapeOneListing(page, listing, cli);
      merged.push(...rows);
    }
  } finally {
    await browser.close();
  }

  const byUrl = new Map();
  for (const r of merged) {
    if (!byUrl.has(r.url)) byUrl.set(r.url, r);
  }
  const unique = Array.from(byUrl.values()).filter((r) => !isExcludedMennicaProductUrl(r.url));

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
  console.log("Далее: npm run mennica:fetch:all");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
