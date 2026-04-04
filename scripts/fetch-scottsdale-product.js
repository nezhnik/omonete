/**
 * Парсинг одной карточки Scottsdale Mint + скачивание в public/image/coins/foreign/<slug>-{obv|rev|…}.webp.
 *
 * Запуск:
 *   node scripts/fetch-scottsdale-product.js "https://www.scottsdalemint.com/product/..."
 */
const fs = require("fs");
const path = require("path");
const os = require("os");
const https = require("https");
const { saveBufferAsForeignUnified } = require("./lib/save-foreign-unified-webp.js");

const ROOT = path.join(__dirname, "..");
const DATA_DIR = path.join(ROOT, "data");
const FOREIGN = path.join(ROOT, "public", "image", "coins", "foreign");

function normalizeUrl(raw) {
  const u = new URL(raw);
  u.hash = "";
  u.search = "";
  return `${u.origin}${u.pathname}`.replace(/\/+$/, "");
}

function slugFromUrl(url) {
  const u = new URL(url);
  const p = u.pathname.split("/").filter(Boolean).pop() || "scottsdale-product";
  return p.toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
}

function shouldSkipRandomTitle(title) {
  const s = String(title || "").toLowerCase();
  if (!s) return false;
  return /\brandom\b|\bmystery\b|\bassorted\b|\bmixed lot\b|\bgrab bag\b/.test(s);
}

function download(url, dst) {
  return new Promise((resolve) => {
    const req = https.get(url, { timeout: 30000, headers: { "user-agent": "Mozilla/5.0" } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        return resolve(download(new URL(res.headers.location, url).toString(), dst));
      }
      if (res.statusCode !== 200) {
        res.resume();
        return resolve(false);
      }
      const ws = fs.createWriteStream(dst);
      res.pipe(ws);
      ws.on("finish", () => ws.close(() => resolve(true)));
      ws.on("error", () => resolve(false));
    });
    req.on("timeout", () => {
      req.destroy();
      resolve(false);
    });
    req.on("error", () => resolve(false));
  });
}

function parseSpecPairsFromText(raw) {
  const out = {};
  const lines = String(raw || "")
    .split("\n")
    .map((x) => x.replace(/\s+/g, " ").trim())
    .filter(Boolean);
  const labels = new Set(["dimensions", "weight", "purity", "manufacturer", "packaging", "grade", "mintage", "obverse design"]);
  for (let i = 0; i < lines.length - 1; i++) {
    const k = lines[i].toLowerCase().replace(/:$/, "").trim();
    if (!labels.has(k)) continue;
    if (!out[lines[i]]) out[lines[i]] = lines[i + 1];
  }
  for (const line of lines) {
    const m = line.match(/^([^:]{2,60}):\s*(.+)$/);
    if (!m) continue;
    const key = m[1].trim();
    if (!labels.has(key.toLowerCase())) continue;
    if (!out[key]) out[key] = m[2].trim();
  }
  return out;
}

async function parseProduct(page, sourceUrl) {
  await page.goto(sourceUrl, { waitUntil: "domcontentloaded", timeout: 120000 });
  await page.waitForTimeout(4500);

  // Попытка открыть Spec-вкладку (если есть).
  const specTabSelectors = [
    ".e-n-tab-title:has-text('Spec')",
    "[role='tab']:has-text('Spec')",
    "button:has-text('Spec')",
    "a:has-text('Spec')",
  ];
  for (const sel of specTabSelectors) {
    const el = page.locator(sel).first();
    if (await el.isVisible().catch(() => false)) {
      await el.click({ timeout: 2500 }).catch(() => {});
      await page.waitForTimeout(900);
      break;
    }
  }

  await page.locator(".gallery-thumbs.swiper-wrapper").first().scrollIntoViewIfNeeded().catch(() => {});
  await page.evaluate(() => {
    document.querySelectorAll(".gallery-thumbs.swiper-wrapper .swiper-slide img").forEach((img) => {
      try {
        img.scrollIntoView({ block: "nearest", inline: "nearest" });
      } catch (_) {}
    });
  });
  await page.waitForTimeout(1200);

  const parsed = await page.evaluate(() => {
    function absUrl(u) {
      if (!u || typeof u !== "string") return null;
      const s = u.trim().split(/\s/)[0];
      if (/^https?:\/\//i.test(s)) return s.split("?")[0];
      if (s.startsWith("//")) return ("https:" + s).split("?")[0];
      if (s.startsWith("/")) return (location.origin + s).split("?")[0];
      return null;
    }

    /** Один снимок в Woo часто дают как …-600x600.jpg, …-1200x1200.jpg и полный файл — считаем одним кадром. */
    function baseKey(u) {
      try {
        const url = new URL(u);
        const p = url.pathname.replace(/-\d+x\d+(?=\.(jpg|jpeg|png|webp))/i, "");
        return (url.origin + p).toLowerCase();
      } catch {
        return String(u).toLowerCase();
      }
    }

    function isProductImageUrl(u) {
      return /scottsdalemint\.com|wp-content|uploads|woocommerce|\/cdn\//i.test(String(u));
    }

    const title =
      (document.querySelector("h1")?.textContent || "")
        .replace(/\s+/g, " ")
        .trim() || null;

    const allTexts = [];
    const candidates = [
      ...document.querySelectorAll(".e-n-tabs, [role='tabpanel'], .elementor-widget-heading, .elementor-widget-text-editor"),
    ];
    for (const c of candidates) {
      const t = (c.innerText || c.textContent || "").trim();
      if (!t) continue;
      if (/dimensions|weight|purity|manufacturer|packaging|grade|mintage|obverse design/i.test(t)) allTexts.push(t);
    }
    const specText = allTexts.join("\n");

    const ordered = [];
    const seen = new Set();

    function pushUnique(pick) {
      if (!pick || !isProductImageUrl(pick)) return;
      if (/spinner|placeholder|blank\.gif|pixel\.gif|^data:/i.test(pick)) return;
      const key = baseKey(pick);
      if (seen.has(key)) return;
      seen.add(key);
      ordered.push(pick);
    }

    function isNoiseProductUrl(u) {
      return /payment|icons-e\d+|payment-icons|logo|sprite|avatar|gravatar|emoji|spinner/i.test(String(u));
    }

    /**
     * Медные Crew и др.: крупный кадр в Elementor до блока с .gallery-thumbs; без этого в ленте только реверс/рендер.
     */
    const thumbsRoot = document.querySelector(".gallery-thumbs");
    if (thumbsRoot) {
      for (const c of document.querySelectorAll(".elementor-widget-container")) {
        if (thumbsRoot.contains(c) || c.contains(thumbsRoot)) continue;
        const pos = thumbsRoot.compareDocumentPosition(c);
        if (!(pos & Node.DOCUMENT_POSITION_PRECEDING)) continue;
        for (const img of c.querySelectorAll("img")) {
          const pick =
            absUrl(img.getAttribute("data-large_image")) ||
            absUrl(img.getAttribute("data-large-image")) ||
            absUrl(img.getAttribute("data-src")) ||
            absUrl(img.getAttribute("data-lazy-src")) ||
            absUrl(img.getAttribute("src"));
          if (!pick || isNoiseProductUrl(pick)) continue;
          pushUnique(pick);
        }
      }
    }

    /**
     * Elementor / Swiper: лента .gallery-item (Scottsdale Crew). После кадров из виджетов выше.
     */
    const thumbsWrap = document.querySelector(".gallery-thumbs.swiper-wrapper");
    if (thumbsWrap) {
      const slides = thumbsWrap.querySelectorAll(".swiper-slide");
      for (const slide of slides) {
        const a = slide.querySelector("a[href]");
        const href = a ? a.getAttribute("href") : null;
        const img = slide.querySelector("img");
        const large =
          img?.getAttribute("data-large_image") ||
          img?.getAttribute("data-large-image") ||
          img?.getAttribute("data-src") ||
          img?.getAttribute("data-lazy-src") ||
          img?.getAttribute("data-original");
        const src = img?.getAttribute("src");
        const pick = absUrl(href) || absUrl(large) || absUrl(src);
        pushUnique(pick);
      }
    }

    if (ordered.length === 0) {
      const gallerySlides = document.querySelectorAll(".woocommerce-product-gallery .woocommerce-product-gallery__image");
      for (const slide of gallerySlides) {
        const a = slide.querySelector("a[href]");
        const href = a ? a.getAttribute("href") : null;
        const img = slide.querySelector("img");
        const large =
          img?.getAttribute("data-large_image") ||
          img?.getAttribute("data-src") ||
          img?.getAttribute("data-lazy-src") ||
          img?.getAttribute("src");
        pushUnique(absUrl(href) || absUrl(large));
      }
    }

    if (ordered.length === 0) {
      const imgNodes = [
        ...document.querySelectorAll(".gallery-thumbs .swiper-wrapper img"),
        ...document.querySelectorAll(".swiper-wrapper img"),
        ...document.querySelectorAll(".woocommerce-product-gallery img"),
      ];
      for (const img of imgNodes) {
        const vals = [
          img.getAttribute("src"),
          img.getAttribute("data-src"),
          img.getAttribute("data-large_image"),
          img.getAttribute("data-lazy-src"),
          img.getAttribute("srcset"),
        ];
        for (const v of vals) {
          if (!v) continue;
          for (const part of String(v).split(",")) {
            pushUnique(absUrl(part.trim().split(/\s+/)[0]));
          }
        }
      }
    }

    return {
      title,
      specText,
      imageUrls: ordered,
    };
  });

  const specs = parseSpecPairsFromText(parsed.specText);
  const imageUrls = parsed.imageUrls.filter((u) => /scottsdalemint\.com|wp-content|cdn/i.test(u));

  return {
    source_url: sourceUrl,
    title: parsed.title,
    specs,
    imageUrls,
    parsedAt: new Date().toISOString(),
  };
}

async function saveParsedProduct(parsed) {
  const sourceUrl = normalizeUrl(parsed.source_url);
  const slug = slugFromUrl(sourceUrl);
  if (fs.existsSync(FOREIGN)) {
    const prefix = `${slug}-`;
    for (const fn of fs.readdirSync(FOREIGN)) {
      if (fn.startsWith(prefix) && /\.webp$/i.test(fn)) {
        try {
          fs.unlinkSync(path.join(FOREIGN, fn));
        } catch (_) {}
      }
    }
  }

  const localImageUrls = [];
  for (let i = 0; i < (parsed.imageUrls || []).length; i++) {
    const u = parsed.imageUrls[i];
    const tmp = path.join(os.tmpdir(), `scd-${slug}-${i}-${Date.now()}`);
    if (!(await download(u, tmp))) continue;
    let buf;
    try {
      buf = fs.readFileSync(tmp);
    } catch (_) {
      continue;
    }
    try {
      fs.unlinkSync(tmp);
    } catch (_) {}
    try {
      localImageUrls.push(await saveBufferAsForeignUnified(buf, slug, i + 1));
    } catch (_) {
      /* empty */
    }
  }

  const out = {
    coin: {
      ...parsed,
      source_url: sourceUrl,
      slug,
      imageUrls: localImageUrls,
      image_obverse: localImageUrls[0] || null,
      image_reverse: localImageUrls[1] || localImageUrls[0] || null,
    },
  };

  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  const outFile = path.join(DATA_DIR, `scottsdale-mint-${slug}.json`);
  fs.writeFileSync(outFile, JSON.stringify(out, null, 2), "utf8");
  return { outFile, imageCount: localImageUrls.length, skippedRandom: false };
}

async function fetchOneWithPage(page, rawUrl) {
  const sourceUrl = normalizeUrl(rawUrl);
  const parsed = await parseProduct(page, sourceUrl);
  if (shouldSkipRandomTitle(parsed.title)) {
    return { outFile: null, imageCount: 0, skippedRandom: true, title: parsed.title };
  }
  return saveParsedProduct(parsed);
}

async function main() {
  const raw = process.argv.find((a) => /^https?:\/\//i.test(a));
  if (!raw) {
    console.error("Передайте URL: node scripts/fetch-scottsdale-product.js \"https://...\"");
    process.exit(1);
  }
  const { chromium } = require("playwright-extra");
  const StealthPlugin = require("puppeteer-extra-plugin-stealth");
  chromium.use(StealthPlugin());
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({
    locale: "en-US",
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  });

  const parsed = await parseProduct(page, normalizeUrl(raw));
  await browser.close();

  if (shouldSkipRandomTitle(parsed.title)) {
    console.log("Пропуск random-карточки:", parsed.title);
    process.exit(0);
  }

  const saved = await saveParsedProduct(parsed);
  console.log("Готово:", saved.outFile);
  console.log("Картинок:", saved.imageCount);
}

module.exports = {
  normalizeUrl,
  slugFromUrl,
  parseProduct,
  fetchOneWithPage,
};

if (require.main === module) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}

