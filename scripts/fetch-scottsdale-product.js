/**
 * Парсинг одной карточки Scottsdale Mint + скачивание изображений в public/image/coins/foreign/scottsdale/<slug>/.
 *
 * Запуск:
 *   node scripts/fetch-scottsdale-product.js "https://www.scottsdalemint.com/product/..."
 */
const fs = require("fs");
const path = require("path");
const https = require("https");

const DATA_DIR = path.join(__dirname, "..", "data");
const IMG_DIR = path.join(__dirname, "..", "public", "image", "coins", "foreign", "scottsdale");

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

  const parsed = await page.evaluate(() => {
    const title =
      (document.querySelector("h1")?.textContent || "")
        .replace(/\s+/g, " ")
        .trim() || null;

    const allTexts = [];
    const candidates = [
      ...document.querySelectorAll(".e-n-tabs, [role='tabpanel'], .elementor-widget-heading, .elementor-widget-text-editor"),
    ];
    for (const c of candidates) {
      const t = (c.textContent || "").replace(/\s+/g, " ").trim();
      if (!t) continue;
      if (/dimensions|weight|purity|manufacturer|packaging|grade|mintage|obverse design/i.test(t)) allTexts.push(t);
    }
    const specText = allTexts.join("\n");

    const imgs = new Set();
    const imgNodes = [
      ...document.querySelectorAll(".gallery-thumbs .swiper-wrapper img"),
      ...document.querySelectorAll(".swiper-wrapper img"),
      ...document.querySelectorAll(".woocommerce-product-gallery img"),
    ];
    for (const img of imgNodes) {
      const vals = [img.getAttribute("src"), img.getAttribute("data-src"), img.getAttribute("srcset")];
      for (const v of vals) {
        if (!v) continue;
        for (const part of String(v).split(",")) {
          const u = part.trim().split(" ")[0];
          if (!u) continue;
          if (/^https?:\/\//i.test(u)) imgs.add(u);
          else if (u.startsWith("//")) imgs.add("https:" + u);
          else if (u.startsWith("/")) imgs.add(location.origin + u);
        }
      }
    }

    return {
      title,
      specText,
      imageUrls: Array.from(imgs),
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
  const coinDir = path.join(IMG_DIR, slug);
  if (!fs.existsSync(coinDir)) fs.mkdirSync(coinDir, { recursive: true });

  const localImageUrls = [];
  for (let i = 0; i < (parsed.imageUrls || []).length; i++) {
    const u = parsed.imageUrls[i];
    const extMatch = String(u).match(/\.(jpg|jpeg|png|webp)(?:$|\?)/i);
    const ext = extMatch ? extMatch[1].toLowerCase() : "jpg";
    const fn = `${String(i + 1).padStart(2, "0")}.${ext}`;
    const abs = path.join(coinDir, fn);
    const rel = `/image/coins/foreign/scottsdale/${slug}/${fn}`;
    if (await download(u, abs)) localImageUrls.push(rel);
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

