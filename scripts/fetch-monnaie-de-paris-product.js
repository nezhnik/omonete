/**
 * Парсинг одной карточки Monnaie de Paris (Magento 2).
 *
 * Заголовок: .page-title-wrapper.product — span.base (серия/коллекция), .nombis-caracteristiques (.nombis, .caracteristiques).
 * Характеристики: table.additional-attributes (th/td).
 * Галерея: JSON в script[type="text/x-magento-init"] → mage/gallery/gallery.data (full, img, caption — Obverse/Reverse и т.д.).
 * Доп. текст: .short-desc-content, #product_view_details .product.attribute.description
 *
 * Запуск:
 *   node scripts/fetch-monnaie-de-paris-product.js "https://www.monnaiedeparis.fr/en/..."
 *
 * Опции: --listing-url URL --listing-label "Coins"
 * Навигация: scripts/mdp-nav-options.js (env MDP_GOTO_* , MDP_SEL_*).
 */
const fs = require("fs");
const path = require("path");
const { mdpPageGotoOptions, mdpSelectorTimeoutsMs } = require("./mdp-nav-options.js");

const DATA_DIR = path.join(__dirname, "..", "data");

function normalizeUrl(raw) {
  const u = new URL(raw);
  u.hash = "";
  return u.toString().replace(/\/$/, "");
}

function slugFromUrl(url) {
  try {
    const u = new URL(url);
    const seg = u.pathname.replace(/\/$/, "").split("/").filter(Boolean);
    return seg[seg.length - 1] || "item";
  } catch {
    return "item";
  }
}

function getArgValue(flag) {
  const i = process.argv.indexOf(flag);
  if (i === -1 || !process.argv[i + 1]) return null;
  return process.argv[i + 1];
}

async function parseMonnaieDeParisProduct(page, sourceUrl, listingMeta) {
  return page.evaluate((payload) => {
    const sourceUrlIn = payload.sourceUrl;
    const text = (el) => (el && el.textContent ? el.textContent.replace(/\s+/g, " ").trim() : "");

    const specs = {};
    const setSpec = (k, v) => {
      const key = String(k || "")
        .replace(/:$/, "")
        .replace(/\s+/g, " ")
        .trim();
      const val = String(v || "").replace(/\s+/g, " ").trim();
      if (key && val && specs[key] == null) specs[key] = val;
    };

    document.querySelectorAll("table.additional-attributes tr").forEach((tr) => {
      const th = tr.querySelector("th.col.label");
      const td = tr.querySelector("td.col.data");
      if (th && td) setSpec(text(th), text(td));
    });

    const skuEl = document.querySelector(".product.attribute.sku .value");
    const sku = skuEl ? text(skuEl) : null;

    const seriesEl = document.querySelector('.page-title-wrapper.product span.base[data-ui-id="page-title-wrapper"]');
    const series_title = seriesEl ? text(seriesEl) : null;
    const nombisEl = document.querySelector(".nombis-caracteristiques .nombis");
    const caracEl = document.querySelector(".nombis-caracteristiques .caracteristiques");
    const subtitle_nombis = nombisEl ? text(nombisEl) : null;
    const subtitle_caracteristiques = caracEl ? text(caracEl) : null;

    const h1 = document.querySelector(".page-title-wrapper.product h1.page-title");
    const title_display = h1 ? text(h1) : text(document.querySelector("h1")) || text(document.querySelector("title"));

    const shortEl = document.querySelector(".short-desc-content");
    const description_short = shortEl ? text(shortEl) : null;

    const detailsRoot = document.querySelector("#product_view_details");
    let description_detailed = null;
    if (detailsRoot) {
      const parts = [];
      detailsRoot.querySelectorAll(".product.attribute.description, .value, p.description").forEach((el) => {
        const t = text(el);
        if (t && t.length > 20) parts.push(t);
      });
      description_detailed = parts.length ? [...new Set(parts)].join("\n\n") : text(detailsRoot);
      if (description_detailed && description_detailed.length > 50000) {
        description_detailed = description_detailed.slice(0, 50000);
      }
    }

    const priceEl = document.querySelector(".product-info-main .price-box .price, .product-info-price .price");
    const price_display = priceEl ? text(priceEl) : null;

    /** Trailing comma в x-magento-init ломает JSON.parse; ищем массив gallery data в HTML целиком (и в innerText скриптов). */
    function extractGalleryDataArray() {
      const chunks = [];
      document.querySelectorAll('script[type="text/x-magento-init"]').forEach((s) => {
        const t = s.textContent || "";
        if (t.includes('"mage/gallery/gallery":')) chunks.push(t);
      });
      chunks.push(document.documentElement.innerHTML);
      for (const t of chunks) {
        if (!t.includes('"mage/gallery/gallery":') || !t.includes('"data":')) continue;
        try {
          const j = JSON.parse(t);
          const holder = j["[data-gallery-role=gallery-placeholder]"];
          const g = holder && holder["mage/gallery/gallery"];
          if (g && Array.isArray(g.data) && g.data.length) return g.data;
        } catch {
          /* fall through */
        }
        const idx = t.indexOf('"mage/gallery/gallery":');
        if (idx === -1) continue;
        const dataKey = t.indexOf('"data":', idx);
        if (dataKey === -1) continue;
        const start = t.indexOf("[", dataKey);
        if (start === -1) continue;
        let depth = 0;
        let end = -1;
        for (let j = start; j < t.length; j++) {
          const c = t[j];
          if (c === "[") depth++;
          else if (c === "]") {
            depth--;
            if (depth === 0) {
              end = j + 1;
              break;
            }
          }
        }
        if (end > start) {
          try {
            const arr = JSON.parse(t.slice(start, end));
            if (Array.isArray(arr) && arr.length) return arr;
          } catch {
            /* ignore */
          }
        }
      }
      return [];
    }

    /** @type {Array<{thumb?:string,img?:string,full?:string,caption?:string,position?:string}>} */
    let galleryData = extractGalleryDataArray();

    /** После инициализации Magento блок x-magento-init исчезает; картинки остаются в Fotorama (.fotorama__wrap). */
    function extractFromFotoramaDom() {
      const root = document.querySelector(".product.media") || document.querySelector(".column.main");
      if (!root) return [];
      const byPath = new Map();
      const canonPath = (u) => {
        try {
          return new URL(u, window.location.origin).pathname.toLowerCase();
        } catch {
          return String(u).split("?")[0].toLowerCase();
        }
      };
      root
        .querySelectorAll(
          ".fotorama__stage img.fotorama__img, .fotorama__nav img.fotorama__img, .fotorama__thumb img"
        )
        .forEach((img) => {
          const u = img.getAttribute("src") || "";
          if (!u || !/\/media\/catalog\/product\//i.test(u)) return;
          const cap = (img.getAttribute("alt") || "").trim();
          const key = canonPath(u);
          const prev = byPath.get(key);
          if (!prev || u.length > (prev.full || "").length) byPath.set(key, { full: u, caption: cap });
        });
      return Array.from(byPath.values()).map((x) => ({
        thumb: null,
        img: x.full,
        full: x.full,
        caption: x.caption,
        position: null,
      }));
    }

    if (!galleryData.length) galleryData = extractFromFotoramaDom();

    /** Magento иногда отдаёт для последнего слайда каталога 120×120 при том же .jpg — тянем 700×700 как у остальных. */
    function mdpUpgradeCatalogImageUrl(u) {
      if (!u || typeof u !== "string") return u;
      try {
        const url = new URL(u, window.location.origin);
        if (!/\/media\/catalog\/product\//i.test(url.pathname)) return u;
        const w = parseInt(url.searchParams.get("width") || "0", 10);
        const h = parseInt(url.searchParams.get("height") || "0", 10);
        if ((w > 0 && w < 400) || (h > 0 && h < 400)) {
          url.searchParams.set("optimize", "medium");
          url.searchParams.set("fit", "bounds");
          url.searchParams.set("height", "700");
          url.searchParams.set("width", "700");
          url.searchParams.set("canvas", "700:700");
        }
        return url.toString();
      } catch {
        return u;
      }
    }

    galleryData = galleryData.map((item) => {
      const rawFull = item.full || item.img || "";
      const rawImg = item.img || item.full || "";
      const full = rawFull ? mdpUpgradeCatalogImageUrl(rawFull) : item.full;
      const img = rawImg ? mdpUpgradeCatalogImageUrl(rawImg) : item.img;
      return { ...item, full: full || item.full, img: img || item.img };
    });

    const pathOrder = [];
    const pathSeen = new Set();
    const pushCanon = (full) => {
      if (!full) return;
      const key = (() => {
        try {
          return new URL(full, window.location.origin).pathname.toLowerCase();
        } catch {
          return full.split("?")[0].toLowerCase();
        }
      })();
      if (pathSeen.has(key)) return;
      pathSeen.add(key);
      pathOrder.push(full);
    };

    const byCaption = { obverse: null, reverse: null, other: [] };
    galleryData.forEach((item) => {
      const full = item.full || item.img || null;
      const cap = (item.caption || "").trim();
      pushCanon(full);
      const low = cap.toLowerCase();
      if (/obverse|avers|recto/i.test(low)) byCaption.obverse = full || byCaption.obverse;
      else if (/reverse|revers|verso/i.test(low)) byCaption.reverse = full || byCaption.reverse;
      else if (full) byCaption.other.push({ url: full, caption: cap });
    });
    const fullUrls = pathOrder;

    let obverse = byCaption.obverse;
    let reverse = byCaption.reverse;
    if (!obverse && fullUrls[0]) obverse = fullUrls[0];
    if (!reverse && fullUrls[1]) reverse = fullUrls[1];
    if (obverse && reverse && obverse === reverse && fullUrls.length > 1) {
      reverse = fullUrls.find((u) => u !== obverse) || reverse;
    }

    const canonKey = (full) => {
      if (!full) return "";
      try {
        return new URL(full, window.location.origin).pathname.toLowerCase();
      } catch {
        return String(full).split("?")[0].toLowerCase();
      }
    };
    const usedPaths = new Set([obverse, reverse].filter(Boolean).map(canonKey).filter(Boolean));
    let packagingList = byCaption.other.filter((x) => x && x.url && !usedPaths.has(canonKey(x.url)));
    const packagingPathSeen = new Set();
    packagingList = packagingList.filter((x) => {
      const k = canonKey(x.url);
      if (packagingPathSeen.has(k)) return false;
      packagingPathSeen.add(k);
      return true;
    });

    return {
      source_url: sourceUrlIn,
      sku,
      series_title,
      subtitle_nombis,
      subtitle_caracteristiques,
      title_display,
      specs,
      description_short,
      description_detailed,
      price_display,
      gallery: galleryData.map((x) => ({
        thumb: x.thumb || null,
        img: x.img || null,
        full: x.full || null,
        caption: x.caption || null,
        position: x.position != null ? String(x.position) : null,
      })),
      classified: {
        obverse,
        reverse,
        packaging: packagingList.length ? packagingList : null,
      },
      imageUrls: fullUrls,
      listing_url: payload.listingUrl || null,
      listing_label: payload.listingLabel || null,
      parsedAt: new Date().toISOString(),
    };
  }, {
    sourceUrl,
    listingUrl: listingMeta?.listing_url || null,
    listingLabel: listingMeta?.listing_label || null,
  });
}

async function main() {
  const rawUrl = process.argv.find((a) => /^https?:\/\/www\.monnaiedeparis\.fr/i.test(a));
  if (!rawUrl) {
    console.error(
      'Укажите URL: node scripts/fetch-monnaie-de-paris-product.js "https://www.monnaiedeparis.fr/en/..."'
    );
    process.exit(1);
  }
  const sourceUrl = normalizeUrl(rawUrl);
  const listingUrl = getArgValue("--listing-url");
  const listingLabel = getArgValue("--listing-label");
  const listingMeta = listingUrl || listingLabel ? { listing_url: listingUrl, listing_label: listingLabel } : null;

  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

  const { chromium } = require("playwright-extra");
  const StealthPlugin = require("puppeteer-extra-plugin-stealth");
  chromium.use(StealthPlugin());
  const browser = await chromium.launch({ headless: process.env.HEADLESS !== "0", args: ["--no-sandbox"] });
  const context = await browser.newContext({
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    locale: "en-GB",
    viewport: { width: 1366, height: 900 },
  });
  const page = await context.newPage();

  let parsed;
  try {
    const selMs = mdpSelectorTimeoutsMs();
    await page.goto(sourceUrl, mdpPageGotoOptions());
    await page
      .locator("button#onetrust-accept-btn-handler")
      .first()
      .click({ timeout: 2000 })
      .catch(() => {});
    await page.waitForTimeout(300);
    await page
      .waitForSelector("table.additional-attributes, .page-title-wrapper.product, [data-gallery-role=gallery-placeholder]", {
        timeout: selMs.main,
      })
      .catch(() => {});
    await page.waitForSelector(".product.media img.fotorama__img", { timeout: selMs.img }).catch(() => {});
    await page.waitForTimeout(400);
    parsed = await parseMonnaieDeParisProduct(page, sourceUrl, listingMeta);
  } finally {
    await browser.close();
  }

  const slug = slugFromUrl(sourceUrl);
  const safe = slug.replace(/[^a-z0-9_-]/gi, "_").slice(0, 120);
  const outFile = path.join(DATA_DIR, `monnaie-de-paris-${safe}.json`);
  fs.writeFileSync(outFile, JSON.stringify(parsed, null, 2), "utf8");
  console.log("Сохранено:", outFile);
  console.log("title_display:", parsed.title_display);
  console.log("SKU:", parsed.sku);
  console.log("Specs:", Object.keys(parsed.specs || {}).length, "полей");
  console.log("Галерея:", (parsed.gallery || []).length, "кадров");
}

if (require.main === module) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}

module.exports = { parseMonnaieDeParisProduct, normalizeUrl, slugFromUrl };
