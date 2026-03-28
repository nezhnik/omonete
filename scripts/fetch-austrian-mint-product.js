/**
 * Парсинг одной карточки Münze Österreich (muenzeoesterreich.com), EN.
 *
 * Листинг: .article-list → ссылки /en/products/{slug}
 * PDP: заголовок h1; цена .product-price; описание и характеристики в .article-accordion-item
 *   (кнопка .title-button — заголовок секции, тело — .collapse; в Specifications строки Key\tValue).
 * Галерея: .gallery-wrapper .thumbs img — порядок слева направо; дубликаты превью отбрасываем.
 *
 * Картинки: в URL файлов монеты обычно есть _VS_ (Vorderseite → classified.obverse) и _RS_ (Rückseite → reverse).
 * Etui / блистер — по подстрокам в пути (Etui, TITEL-3D_Blister, Innenseite …). Размер: product_full вместо product_preview.
 * Если _VS_/_RS_ не найдены — fallback: первые три уникальных кадра без «упаковочных» имён → reverse, obverse, box
 * (как задано вручную для простых трёх миниатюр).
 *
 * Запуск:
 *   node scripts/fetch-austrian-mint-product.js "https://www.muenzeoesterreich.com/en/products/..."
 *
 * Опции: --listing-url URL --listing-label "Gold coins"
 */
const fs = require("fs");
const path = require("path");

const DATA_DIR = path.join(__dirname, "..", "data");

function normalizeUrl(raw) {
  const u = new URL(raw);
  u.hash = "";
  u.pathname = u.pathname.replace(/\/\.\//g, "/").replace(/^\.\//, "/");
  return u.toString().replace(/\/$/, "");
}

function slugFromUrl(url) {
  try {
    const u = new URL(url);
    const parts = u.pathname.split("/").filter(Boolean);
    const idx = parts.indexOf("products");
    if (idx >= 0 && parts[idx + 1]) return parts[idx + 1];
    return parts[parts.length - 1] || "item";
  } catch {
    return "item";
  }
}

function getArgValue(flag) {
  const i = process.argv.indexOf(flag);
  if (i === -1 || !process.argv[i + 1]) return null;
  return process.argv[i + 1];
}

function upgradeProductImgUrl(u) {
  if (!u || typeof u !== "string") return u;
  return u.replace(/\/_aliases\/product_preview\//i, "/_aliases/product_full/");
}

/** Уникальность миниатюр: одно и то же имя файла в preview/full и повторы в карусели. */
function thumbFileKey(u) {
  try {
    const url = new URL(u, "https://www.muenzeoesterreich.com");
    const seg = url.pathname.split("/").filter(Boolean).pop() || "";
    return seg.toLowerCase().split("?")[0];
  } catch {
    return String(u)
      .toLowerCase()
      .split("?")[0];
  }
}

function isPackagingFilename(u) {
  const s = String(u).toLowerCase();
  return (
    /etui|titel-3d_blister|_blister.*\.png|innenseite|rueckseite-3d_blister|linke_innenseite|rechte_innenseite/i.test(
      s
    ) && !/_vs_|_rs_/i.test(s)
  );
}

function classifyGalleryUrls(orderedUniqueFull) {
  const list = orderedUniqueFull.filter(Boolean);
  let obverse = list.find((u) => /_VS_/i.test(u)) || null;
  let reverse = list.find((u) => /_RS_/i.test(u)) || null;
  let box = list.find((u) => /etui|[-_]box[-_]/i.test(u) && !/blister/i.test(u)) || null;
  let packaging = list.find((u) => /titel-3d_blister|titel.*blister/i.test(u)) || null;

  const blisterHits = list.filter(
    (u) =>
      /innenseite|rueckseite-3d_blister/i.test(u) &&
      !/_vs_|_rs_/i.test(u)
  );
  let blister_reverse = blisterHits[0] || null;
  let blister_obverse = blisterHits[1] || null;

  if (!obverse || !reverse) {
    const coinLike = list.filter((u) => !isPackagingFilename(u) && /_vs_|_rs_/i.test(u));
    const rest = list.filter((u) => !isPackagingFilename(u));
    const pool = coinLike.length >= 2 ? coinLike : rest;
    if (!reverse && pool[0]) reverse = pool[0];
    if (!obverse && pool[1]) obverse = pool[1];
    if (!box && pool[2]) box = pool[2];
  }

  if (!packaging && blister_reverse) packaging = blister_reverse;

  return {
    obverse,
    reverse,
    blister_obverse,
    blister_reverse,
    packaging,
    box,
    certificate: null,
  };
}

async function parseAustrianMintProduct(page, sourceUrl, listingMeta) {
  const raw = await page.evaluate((payload) => {
    const sourceUrlIn = payload.sourceUrl;
    const text = (el) => (el && el.textContent ? el.textContent.replace(/\s+/g, " ").trim() : "");

    const upgrade = (u) =>
      String(u || "").replace(/\/_aliases\/product_preview\//i, "/_aliases/product_full/");
    const fileKey = (u) => {
      try {
        const url = new URL(u, window.location.origin);
        const seg = url.pathname.split("/").filter(Boolean).pop() || "";
        return seg.toLowerCase().split("?")[0];
      } catch {
        return String(u)
          .toLowerCase()
          .split("?")[0];
      }
    };

    const title = text(document.querySelector("h1")) || text(document.querySelector("title"));

    const priceEl = document.querySelector(".product-price .price.current, .product-price");
    const price_display = priceEl ? text(priceEl) : null;

    let descriptionPlain = "";
    const specs = {};
    const accordionPlain = {};

    document.querySelectorAll(".article-accordion-item").forEach((item) => {
      const head = text(item.querySelector(".title-button, button.title-button"));
      const body = item.querySelector(".collapse");
      const bodyText = body ? text(body) : "";
      if (!head) return;
      accordionPlain[head] = bodyText;

      if (/^description$/i.test(head)) {
        descriptionPlain = bodyText;
      }
      if (/^specifications$/i.test(head) && bodyText) {
        bodyText.split("\n").forEach((line) => {
          const t = line.replace(/\s+/g, " ").trim();
          if (!t) return;
          const tab = t.indexOf("\t");
          if (tab > 0) {
            const k = t.slice(0, tab).replace(/:\s*$/, "").trim();
            const v = t.slice(tab + 1).trim();
            if (k && v && specs[k] == null) specs[k] = v;
          } else {
            const m = t.match(/^([^:]+):\s*(.+)$/);
            if (m && m[1].length < 80) {
              const k = m[1].trim();
              const v = m[2].trim();
              if (k && v && specs[k] == null) specs[k] = v;
            }
          }
        });
      }
    });

    const thumbsRoot = document.querySelector(".gallery-wrapper .thumbs");
    const orderedUnique = [];
    const seen = new Set();
    if (thumbsRoot) {
      thumbsRoot.querySelectorAll("img").forEach((img) => {
        const rawSrc = img.getAttribute("src") || img.getAttribute("data-src") || "";
        if (!rawSrc || !/^https?:\/\//i.test(rawSrc)) return;
        const u = upgrade(rawSrc);
        const k = fileKey(u);
        if (!k || seen.has(k)) return;
        seen.add(k);
        orderedUnique.push(u);
      });
    }

    return {
      source_url: sourceUrlIn,
      title: title || null,
      specs,
      descriptionPlain,
      accordionPlain,
      price_display,
      imageUrls: orderedUnique.slice(),
      listing_url: payload.listingUrl || null,
      listing_label: payload.listingLabel || null,
      parsedAt: new Date().toISOString(),
    };
  }, {
    sourceUrl,
    listingUrl: listingMeta?.listing_url || null,
    listingLabel: listingMeta?.listing_label || null,
  });

  raw.classified = classifyGalleryUrls(raw.imageUrls || []);
  return raw;
}

async function main() {
  const rawUrl = process.argv.find((a) => /^https?:\/\/www\.muenzeoesterreich\.com/i.test(a));
  if (!rawUrl) {
    console.error(
      'Укажите URL: node scripts/fetch-austrian-mint-product.js "https://www.muenzeoesterreich.com/en/products/..."'
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
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    locale: "en-GB",
    viewport: { width: 1366, height: 900 },
  });
  const page = await context.newPage();

  let parsed;
  try {
    await page.goto(sourceUrl, { waitUntil: "networkidle", timeout: 120000 });
    await page.waitForSelector("h1, .gallery-wrapper, .article-accordion-item", { timeout: 25000 }).catch(() => {});
    await page.waitForTimeout(600);
    parsed = await parseAustrianMintProduct(page, sourceUrl, listingMeta);
  } finally {
    await browser.close();
  }

  const slug = slugFromUrl(sourceUrl);
  const outFile = path.join(DATA_DIR, `austrian-mint-${slug}.json`);
  fs.writeFileSync(outFile, JSON.stringify(parsed, null, 2), "utf8");
  console.log("Сохранено:", outFile);
  console.log("Title:", parsed.title);
  console.log("classified:", parsed.classified);
}

if (require.main === module) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}

module.exports = {
  parseAustrianMintProduct,
  normalizeUrl,
  slugFromUrl,
  upgradeProductImgUrl,
  thumbFileKey,
  classifyGalleryUrls,
};
