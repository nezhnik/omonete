/**
 * Сбор URL карточек с листингов PAMP.
 *
 * Режим 1 — только collectibles (по умолчанию), поведение как раньше, не ломать:
 *   node scripts/fetch-pamp-listing.js
 *   → https://www.pamp.com/collections/collectibles
 *   → DOM: ссылки с /collections/collectibles/
 *   → GraphQL: только productsByType / component_collectible
 *   → data/pamp-collectibles-listing-products.json, scripts/pamp-collectibles-urls.txt
 *
 * Режим 2 — другие коллекции (minted bars, cast bars и т.п.);
 *   npm run pamp:sync:minted-bars | npm run pamp:sync:cast-bars
 *   node scripts/fetch-pamp-listing.js "https://www.pamp.com/collections/minted-bars"
 *   node scripts/fetch-pamp-listing.js "https://www.pamp.com/collections/cast-bars" → pamp-cast-bars-urls.txt
 *   → Листинг: .catalog-list .item — превью (flip-box, p.item__name), ссылка a[href*="/product/"].
 *   → Описание и характеристики снимаются со страницы товара (.product-description__text,
 *      .product-description__product-properties), т.к. на листинге этих блоков нет.
 *   → «Ещё»: button.show-more__button (и запасные селекторы).
 *   → GraphQL: дополняет URL/title; description/specs с PDP не затираются.
 */
const fs = require("fs");
const path = require("path");

const DEFAULT_LISTING_URL = "https://www.pamp.com/collections/collectibles";
const SCRIPT_DIR = __dirname;

function resolveOutputs(listingUrl) {
  let u;
  try {
    u = new URL(listingUrl);
  } catch {
    return null;
  }
  const parts = u.pathname.replace(/\/+$/, "").split("/").filter(Boolean);
  const slug = parts.length ? parts[parts.length - 1] : "listing";
  const isCollectibles =
    /\/collections\/collectibles$/i.test(u.pathname) || listingUrl.trim() === DEFAULT_LISTING_URL;

  if (isCollectibles) {
    return {
      mode: "collectibles",
      listingUrl: DEFAULT_LISTING_URL,
      urlListFile: path.join(SCRIPT_DIR, "pamp-collectibles-urls.txt"),
      productsJson: path.join(SCRIPT_DIR, "..", "data", "pamp-collectibles-listing-products.json"),
    };
  }
  return {
    mode: "other",
    listingUrl: u.toString().replace(/\/+$/, ""),
    urlListFile: path.join(SCRIPT_DIR, `pamp-${slug}-urls.txt`),
    productsJson: path.join(SCRIPT_DIR, "..", "data", `pamp-${slug}-listing-products.json`),
  };
}

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

/** Как было для collectibles: только ссылки на подколлекцию collectibles. */
async function extractItemsCollectibles(page) {
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

/** Данные блоков product-description на странице одного товара. */
async function extractPdpProductDetails(page) {
  return page.evaluate(() => {
    const parseSpecsFromProperties = (el) => {
      if (!el) return {};
      const specs = {};
      const rows = el.querySelectorAll("p.product-description__property-title");
      if (rows.length) {
        for (const p of rows) {
          const k = (p.querySelector(".product-description__property-text")?.textContent || "")
            .replace(/:$/, "")
            .trim();
          const v = (p.querySelector(".product-description__property-value")?.textContent || "")
            .replace(/\s+/g, " ")
            .trim();
          if (k && v && specs[k] === undefined) specs[k] = v;
        }
        return specs;
      }
      const rawTxt = (el.innerText || el.textContent || "").trim();
      if (!rawTxt) return {};
      const lines = rawTxt.split("\n").map((x) => x.trim()).filter(Boolean);
      for (let i = 0; i + 1 < lines.length; i += 2) {
        const k = lines[i].replace(/:$/, "").trim();
        const v = lines[i + 1];
        if (k && v && specs[k] === undefined) specs[k] = v;
      }
      return specs;
    };
    const nameEl = document.querySelector(".product-description__name, h2.product-description__name");
    const title = (nameEl?.textContent || "").replace(/\s+/g, " ").trim() || null;
    const descEl = document.querySelector(".product-description__text");
    const description = descEl
      ? (descEl.innerText || descEl.textContent || "").replace(/\s+/g, " ").trim() || null
      : null;
    const propsEl = document.querySelector(".product-description__product-properties");
    const specsRaw = parseSpecsFromProperties(propsEl);
    const specs = Object.keys(specsRaw).length ? specsRaw : null;
    return { title, description, specs };
  });
}

/**
 * Minted bars и аналогичные листинги: карточки — .catalog-list .item (Svelte),
 * на листинге обычно только превью и .item__name; полное описание — на PDP.
 */
async function extractItemsOtherCollections(page) {
  return page.evaluate(() => {
    const toAbs = (href) => {
      if (!href) return null;
      if (/^https?:\/\//i.test(href)) return href;
      if (href.startsWith("/")) return window.location.origin + href;
      return window.location.origin + "/" + href;
    };
    const parseSpecsFromProperties = (el) => {
      if (!el) return {};
      const specs = {};
      const rows = el.querySelectorAll("p.product-description__property-title");
      if (rows.length) {
        for (const p of rows) {
          const k = (p.querySelector(".product-description__property-text")?.textContent || "")
            .replace(/:$/, "")
            .trim();
          const v = (p.querySelector(".product-description__property-value")?.textContent || "")
            .replace(/\s+/g, " ")
            .trim();
          if (k && v && specs[k] === undefined) specs[k] = v;
        }
        return specs;
      }
      const rawTxt = (el.innerText || el.textContent || "").trim();
      if (!rawTxt) return {};
      const lines = rawTxt.split("\n").map((x) => x.trim()).filter(Boolean);
      for (let i = 0; i + 1 < lines.length; i += 2) {
        const k = lines[i].replace(/:$/, "").trim();
        const v = lines[i + 1];
        if (k && v && specs[k] === undefined) specs[k] = v;
      }
      return specs;
    };
    const out = [];
    const seenUrl = new Set();
    const items = document.querySelectorAll(".catalog-list .item");
    items.forEach((item) => {
      const link = item.querySelector('a[href*="/product/"]');
      let href = link ? toAbs(link.getAttribute("href") || "") : null;
      if (href && (!/\/product\/[^/]+\/[^/]+/i.test(href) || /login|cart|privacy|terms|account|search/i.test(href)))
        href = null;
      const titleEl = item.querySelector(".product-description__name, h2.product-description__name");
      const title =
        (titleEl?.textContent || "").replace(/\s+/g, " ").trim() ||
        (item.querySelector(".item__name a, .item__name")?.textContent || "").replace(/\s+/g, " ").trim() ||
        (item.querySelector(".catalog-item__title")?.textContent || "").trim() ||
        (item.querySelector("img")?.getAttribute("alt") || "").trim() ||
        null;
      const descEl = item.querySelector(".product-description__text");
      const description = descEl
        ? (descEl.innerText || descEl.textContent || "").replace(/\s+/g, " ").trim() || null
        : null;
      const propsEl = item.querySelector(".product-description__product-properties");
      const specsRaw = parseSpecsFromProperties(propsEl);
      const specs = Object.keys(specsRaw).length ? specsRaw : null;
      if (!href && !title) return;
      if (href) {
        if (seenUrl.has(href)) return;
        seenUrl.add(href);
      }
      out.push({ url: href, title, description, specs });
    });
    return out;
  });
}

async function clickShowMoreCollectibles(page) {
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

async function clickShowMoreOther(page) {
  const sels = [
    "button.show-more__button",
    ".show-more .show-more__button",
    ".show-more button",
    "button:has-text('SHOW MORE')",
    "button:has-text('Show more')",
    "button:has-text('Load more')",
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

function productsFromGraphqlJson(json) {
  if (!json || typeof json !== "object") return [];
  const d = json.data;
  if (!d || typeof d !== "object") return [];
  if (Array.isArray(d.products)) return d.products;
  if (Array.isArray(d.productsByType)) return d.productsByType;
  for (const v of Object.values(d)) {
    if (Array.isArray(v) && v.length && v[0] && typeof v[0] === "object" && "alias" in v[0]) return v;
  }
  return [];
}

function mergeGqlProducts(gqlProducts, products) {
  for (const p of products) {
    const alias = String(p?.alias || "").trim();
    if (!alias) continue;
    const url = alias.startsWith("http") ? alias : `https://www.pamp.com${alias.startsWith("/") ? "" : "/"}${alias}`;
    const normalized = normalizeUrl(url);
    if (!normalized) continue;
    gqlProducts.set(normalized, { url: normalized, title: p?.title || null });
  }
}

async function main() {
  const argUrl = process.argv.find((a) => /^https?:\/\/www\.pamp\.com\/collections\//i.test(a));
  const listingUrl = (argUrl || DEFAULT_LISTING_URL).trim();
  const outs = resolveOutputs(listingUrl);
  if (!outs) {
    console.error("Некорректный URL:", listingUrl);
    process.exit(1);
  }

  const DATA_DIR = path.join(SCRIPT_DIR, "..", "data");
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

  const isCollectibles = outs.mode === "collectibles";

  page.on("response", async (res) => {
    if (!/\/graphql$/i.test(res.url())) return;
    try {
      const bodyRaw = res.request().postData() || "";
      if (isCollectibles) {
        const body = bodyRaw ? JSON.parse(bodyRaw) : null;
        const query = String(body?.query || "");
        if (!/productsByType|products\(type:\s*\"component_collectible\"/i.test(query)) return;
        const json = await res.json();
        const products = Array.isArray(json?.data?.products) ? json.data.products : [];
        mergeGqlProducts(gqlProducts, products);
      } else {
        if (!bodyRaw || !/\bproducts\b/i.test(bodyRaw)) return;
        const json = await res.json();
        mergeGqlProducts(gqlProducts, productsFromGraphqlJson(json));
      }
    } catch {
      // ignore
    }
  });

  const extractItems = isCollectibles ? extractItemsCollectibles : extractItemsOtherCollections;
  const clickShowMore = isCollectibles ? clickShowMoreCollectibles : clickShowMoreOther;

  const byUrl = new Map();
  const productsWithoutUrl = [];
  try {
    if (!isCollectibles) console.log("Листинг (прочая коллекция):", outs.listingUrl);
    await page.goto(outs.listingUrl, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForTimeout(1500);
    await clickCookie(page);
    await page.waitForTimeout(1000);

    for (let i = 0; i < 120; i++) {
      const items = await extractItems(page);
      if (isCollectibles) {
        for (const it of items) {
          const u = normalizeUrl(it.url);
          if (!u) continue;
          if (!byUrl.has(u)) byUrl.set(u, { url: u, title: it.title || null });
        }
      } else {
        for (const it of items) {
          const u = it.url ? normalizeUrl(it.url) : null;
          const row = {
            url: u,
            title: it.title || null,
            description: it.description || null,
            specs: it.specs || null,
          };
          if (u) {
            if (!byUrl.has(u)) byUrl.set(u, row);
            else {
              const cur = byUrl.get(u);
              if (row.description) cur.description = row.description;
              if (row.specs) cur.specs = row.specs;
              if (row.title) cur.title = row.title;
            }
          } else if (it.title) {
            productsWithoutUrl.push(row);
          }
        }
      }
      const clicked = await clickShowMore(page);
      if (!clicked) break;
      await page.waitForTimeout(1400);
    }
    await page.waitForTimeout(2000);

    if (!isCollectibles) {
      for (const [u, gql] of gqlProducts.entries()) {
        if (!byUrl.has(u))
          byUrl.set(u, { url: u, title: gql.title || null, description: null, specs: null });
        else {
          const cur = byUrl.get(u);
          if (!cur.title && gql.title) cur.title = gql.title;
        }
      }
      const pdpUrls = Array.from(byUrl.keys()).filter((u) => u && /\/product\//i.test(u));
      if (process.env.PAMP_LISTING_SKIP_PDP === "1") {
        console.log("PAMP_LISTING_SKIP_PDP=1 — обход страниц товара пропущен.");
      } else {
        let done = 0;
        for (const u of pdpUrls) {
          done++;
          if (done === 1 || done % 15 === 0) console.log("Страницы товара:", done, "/", pdpUrls.length);
          await page.goto(u, { waitUntil: "domcontentloaded", timeout: 60000 });
          await page.waitForTimeout(700);
          await clickCookie(page);
          const d = await extractPdpProductDetails(page).catch(() => ({
            title: null,
            description: null,
            specs: null,
          }));
          const cur = byUrl.get(u);
          if (cur) {
            if (d.title && !cur.title) cur.title = d.title;
            if (d.description) cur.description = d.description;
            if (d.specs) cur.specs = d.specs;
          }
        }
      }
    }
  } finally {
    await browser.close();
  }

  if (isCollectibles) {
    for (const [u, item] of gqlProducts.entries()) {
      if (!byUrl.has(u)) byUrl.set(u, item);
    }
  }

  const products = isCollectibles
    ? Array.from(byUrl.values()).sort((a, b) => a.url.localeCompare(b.url))
    : [...Array.from(byUrl.values()), ...productsWithoutUrl].sort((a, b) => {
        if (a.url && b.url) return a.url.localeCompare(b.url);
        if (a.url) return -1;
        if (b.url) return 1;
        return (a.title || "").localeCompare(b.title || "");
      });
  fs.writeFileSync(
    outs.productsJson,
    JSON.stringify({ source: outs.listingUrl, updatedAt: new Date().toISOString(), products }, null, 2),
    "utf8"
  );
  const urlLines = products.map((x) => x.url).filter(Boolean);
  fs.writeFileSync(outs.urlListFile, urlLines.join("\n") + (urlLines.length ? "\n" : ""), "utf8");
  if (isCollectibles) console.log("Собрано URL:", products.length);
  else console.log("Собрано позиций:", products.length, "| только URL:", urlLines.length);
  console.log("Список URL:", outs.urlListFile);
  console.log("Снимок:", outs.productsJson);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
