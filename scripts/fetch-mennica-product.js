/**
 * Парсинг одной карточки Mennica Polska (WooCommerce).
 * Характеристики: .product-information-content (dl/dt/dd, tr, p.pairs).
 * Вкладки: .woocommerce-tabs / .wc-tabs-wrapper (#tab-description, #tab-additional_information).
 *
 * Запуск:
 *   node scripts/fetch-mennica-product.js "https://inwestycje.mennica.com.pl/product/..."
 * Опции: --listing-url URL --listing-label "Collectible products"
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
    const idx = parts.indexOf("product");
    if (idx >= 0 && parts[idx + 1]) return parts[idx + 1];
    return parts[parts.length - 1] || "item";
  } catch {
    return "item";
  }
}

function mergeSpecsFromPlain(specs, plain) {
  if (!plain || !specs) return;
  const t = String(plain).replace(/\s+/g, " ").trim();
  if (!t) return;
  if (!specs.Mintage) {
    const m1 = t.match(/\bmintage\s*[:\s]+([\d\s.,]+)\b/i);
    const m2 = t.match(/\b(?:limit|limited)\s+to\s+([\d\s.,]+)\s*(?:pcs|pieces|szt)?\b/i);
    const m3 = t.match(/\b([\d\s.,]+)\s*(?:pcs|pieces)\s+(?:mintage|limit)\b/i);
    const mPl = t.match(/\bnakład\s*[:\s]+([\d\s.,]+)\b/i);
    const hit = m1 || m2 || m3 || mPl;
    if (hit) specs.Mintage = hit[1].replace(/\s+/g, " ").trim();
  }
}

function getArgValue(flag) {
  const i = process.argv.indexOf(flag);
  if (i === -1 || !process.argv[i + 1]) return null;
  return process.argv[i + 1];
}

async function parseMennicaProduct(page, sourceUrl, listingMeta) {
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

    const h1 = text(document.querySelector("h1.product_title")) || text(document.querySelector("h1"));
    const title = h1 || text(document.querySelector("title"));

    const infoRoot = document.querySelector(".product-information-content");
    if (infoRoot) {
      infoRoot.querySelectorAll(".content-item").forEach((row) => {
        const k = text(row.querySelector(".title"));
        const v = text(row.querySelector(".value"));
        const key = k.replace(/:\s*$/, "").trim();
        if (key && v) setSpec(key, v);
      });
      infoRoot.querySelectorAll("dt").forEach((dt) => {
        const k = text(dt);
        const dd = dt.nextElementSibling;
        if (dd && dd.tagName === "DD") setSpec(k, text(dd));
      });
      infoRoot.querySelectorAll("tr").forEach((tr) => {
        const cells = tr.querySelectorAll("td, th");
        if (cells.length >= 2) setSpec(text(cells[0]), text(cells[1]));
      });
      infoRoot.querySelectorAll("p, .row, .item").forEach((p) => {
        const raw = text(p);
        const m = raw.match(/^([^:]+):\s*(.+)$/);
        if (m && m[1].length < 80 && m[1].length > 1) setSpec(m[1], m[2]);
      });
    }

    document.querySelectorAll("table.shop_attributes tr, table.woocommerce-product-attributes tr").forEach((tr) => {
      const th = tr.querySelector("th");
      const td = tr.querySelector("td");
      if (th && td) setSpec(text(th), text(td));
    });

    const tabAdd = document.querySelector("#tab-additional_information, #tab-additional-information");
    if (tabAdd) {
      tabAdd.querySelectorAll("tr").forEach((tr) => {
        const cells = tr.querySelectorAll("td, th");
        if (cells.length >= 2) setSpec(text(cells[0]), text(cells[1]));
      });
    }

    const descEl = document.querySelector("#tab-description, .woocommerce-Tabs-panel--description");
    const descriptionPlain = descEl ? text(descEl) : "";

    const tabsPlain = {};
    document.querySelectorAll(".woocommerce-tabs .panel, .wc-tab").forEach((panel) => {
      const id = panel.id || panel.getAttribute("aria-labelledby") || "";
      const key = id.replace(/^tab-/, "") || "panel";
      const t = text(panel);
      if (t) tabsPlain[key] = t;
    });

    const getImg = (img) => {
      if (!img) return null;
      return (
        img.getAttribute("data-large_image") ||
        img.getAttribute("data-src") ||
        img.getAttribute("data-lazy-src") ||
        img.getAttribute("src") ||
        null
      );
    };

    /** Убирает -600x600 перед расширением — иначе первые два <img> дают одну и ту же reverse в разных размерах. */
    const normalizeCanon = (u) => {
      if (!u) return "";
      try {
        const url = new URL(u, window.location.origin);
        const p = url.pathname.replace(/-\d+x\d+(?=\.[^.]+)/gi, "");
        return (url.origin + p).toLowerCase();
      } catch {
        return String(u)
          .split("?")[0]
          .toLowerCase()
          .replace(/-\d+x\d+(?=\.[^.]+)/gi, "");
      }
    };

    /** Не считать монетой: коробка, сертификат, блистер, упаковка (см. docs/PARSING-CONTRACT.md). */
    const isPackagingShot = (u) =>
      /[_-](box|cert|certificate|package|packaging|etui|capsule|blister|coa|sleeve|wrapper|kapsul)\b/i.test(u);

    /**
     * WooCommerce часто даёт имена вида COIN_obverse_.png — после obverse/reverse идёт «_», и в JS \b там не срабатывает
     * (подчёркивание входит в \\w). Без этого byObv/byRev не находятся и аверс/реверс берутся по порядку галереи — путаница.
     */
    const urlHasFaceToken = (u, face) => {
      const s = String(u);
      const t = face === "reverse" ? "reverse" : "obverse";
      return new RegExp(`(?:^|[/?#_-])${t}(?:[._/?#-]|_|$)`, "i").test(s);
    };

    let obverse = null;
    let reverse = null;
    let uniqueOrdered = [];
    const gallery = document.querySelector(".woocommerce-product-gallery__wrapper, .woocommerce-product-gallery, .product-images");
    if (gallery) {
      uniqueOrdered = [];
      const seen = new Set();
      gallery.querySelectorAll("img").forEach((img) => {
        const u = getImg(img);
        if (!u) return;
        const c = normalizeCanon(u);
        if (!c || seen.has(c)) return;
        seen.add(c);
        uniqueOrdered.push(u);
      });
      const byObv = uniqueOrdered.find((u) => urlHasFaceToken(u, "obverse"));
      const byRev = uniqueOrdered.find((u) => urlHasFaceToken(u, "reverse"));
      if (byObv) obverse = byObv;
      if (byRev) reverse = byRev;
      if (!obverse) {
        obverse =
          uniqueOrdered.find((u) => !isPackagingShot(u) && normalizeCanon(u) !== normalizeCanon(reverse || "")) ||
          uniqueOrdered[0] ||
          null;
      }
      if (!reverse) {
        reverse =
          uniqueOrdered.find(
            (u) => normalizeCanon(u) !== normalizeCanon(obverse || "") && !isPackagingShot(u)
          ) || null;
      }
      if (obverse && reverse && normalizeCanon(obverse) === normalizeCanon(reverse)) {
        reverse = uniqueOrdered.find((u) => normalizeCanon(u) !== normalizeCanon(obverse)) || null;
      }
    }
    if (!obverse) {
      const first = document.querySelector(".woocommerce-product-gallery__image img, .wp-post-image");
      obverse = getImg(first);
    }

    const coinObvC = normalizeCanon(obverse);
    const coinRevC = normalizeCanon(reverse);
    let certificate = null;
    let box = null;
    let packaging = null;
    const blisterHits = [];
    for (const u of uniqueOrdered) {
      const c = normalizeCanon(u);
      if (!c || c === coinObvC || c === coinRevC) continue;
      const L = u.toLowerCase();
      if (/(certificate|[_-]cert\b|[_-]coa\b|authenticity)/i.test(L)) {
        if (!certificate) certificate = u;
        continue;
      }
      if (/[_-]box\b/i.test(L)) {
        if (!box) box = u;
        continue;
      }
      if (/[_-](package|packaging|etui|sleeve|wrapper)\b/i.test(L)) {
        if (!packaging) packaging = u;
        continue;
      }
      if (/[_-](blister|capsule|kapsul)\b/i.test(L)) blisterHits.push(u);
    }
    let blister_obverse = null;
    let blister_reverse = null;
    if (blisterHits.length) {
      blister_reverse = blisterHits[0];
      blister_obverse = blisterHits[1] || null;
    }
    if (!packaging && blister_reverse) packaging = blister_reverse;

    const priceEl = document.querySelector("p.price, .summary .price, .product-price");
    const priceDisplay = priceEl ? text(priceEl) : null;

    const imageUrls =
      uniqueOrdered.length > 0 ? [...uniqueOrdered] : Array.from(new Set([obverse, reverse].filter(Boolean)));

    return {
      source_url: sourceUrlIn,
      title: title || null,
      specs,
      descriptionPlain,
      tabsPlain,
      price_display: priceDisplay,
      classified: {
        obverse,
        reverse,
        blister_obverse,
        blister_reverse,
        packaging,
        box,
        certificate,
      },
      imageUrls,
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
  const rawUrl = process.argv.find((a) => /^https?:\/\/inwestycje\.mennica\.com\.pl/i.test(a));
  if (!rawUrl) {
    console.error('Укажите URL: node scripts/fetch-mennica-product.js "https://inwestycje.mennica.com.pl/product/..."');
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
    await page.goto(sourceUrl, { waitUntil: "networkidle", timeout: 90000 });
    await page.waitForSelector(".product-information-content .content-item, .woocommerce-tabs, h1.product_title", {
      timeout: 20000,
    }).catch(() => {});
    await page.waitForTimeout(800);
    parsed = await parseMennicaProduct(page, sourceUrl, listingMeta);
    mergeSpecsFromPlain(parsed.specs, parsed.descriptionPlain);
    for (const t of Object.values(parsed.tabsPlain || {})) mergeSpecsFromPlain(parsed.specs, t);
  } finally {
    await browser.close();
  }

  const slug = slugFromUrl(sourceUrl);
  const outFile = path.join(DATA_DIR, `mennica-${slug}.json`);
  fs.writeFileSync(outFile, JSON.stringify(parsed, null, 2), "utf8");
  console.log("Сохранено:", outFile);
  console.log("Title:", parsed.title);
  console.log("Specs keys:", Object.keys(parsed.specs || {}).length);
}

if (require.main === module) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}

module.exports = { parseMennicaProduct, normalizeUrl, slugFromUrl, mergeSpecsFromPlain };
