/**
 * Докачивает картинки для 7 недостающих Kookaburra с Chards.
 *
 * URL берём из вывода check-chards-kookaburra-missing.js.
 * Логика такая же, как в scrape-chards-kookaburra-images.js:
 *  - заходим на страницу товара;
 *  - в aria-label="Image Carousel" берём первые две картинки (reverse, obverse);
 *  - сохраняем webp в public/image/coins/chards-kookaburra;
 *  - дописываем/обновляем запись в data/chards-kookaburra-raw.json.
 *
 * Запуск:
 *   node scripts/scrape-chards-kookaburra-extra-7.js
 */

/* eslint-disable no-console */

const fs = require("fs");
const path = require("path");
const sharp = require("sharp");

const PRODUCT_BASE = "https://www.chards.co.uk";

const EXTRA_URLS = [
  "https://www.chards.co.uk/2009-koobaburra-silver-coin-2005-design/2522",
  "https://www.chards.co.uk/2009-koobaburra-silver-coin-1996-design/2532",
  "https://www.chards.co.uk/2009-koobaburra-silver-coin-1997-design/2533",
  "https://www.chards.co.uk/2009-koobaburra-silver-coin-2001-design/2535",
  "https://www.chards.co.uk/2009-koobaburra-silver-coin-2003-design/2538",
  "https://www.chards.co.uk/2009-silver-10-oz-kookabura/5336",
  "https://www.chards.co.uk/2009-koobaburra-silver-coin-1991-design/2527",
];

const PROJECT_ROOT = path.join(__dirname, "..");
const DATA_DIR = path.join(PROJECT_ROOT, "data");
const PUBLIC_DIR = path.join(PROJECT_ROOT, "public");
const OUT_DIR = path.join(PUBLIC_DIR, "image", "coins", "chards-kookaburra");
const OUT_JSON = path.join(DATA_DIR, "chards-kookaburra-raw.json");

const MAX_SIDE = 1200;

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function normalizeUrl(u) {
  if (!u) return null;
  let url = String(u);
  if (url.startsWith("//")) url = `https:${url}`;
  if (url.startsWith("/")) url = PRODUCT_BASE + url;
  if (!url.startsWith("http")) return null;
  return url;
}

function slugFromProductUrl(url) {
  try {
    const u = new URL(url);
    const segments = u.pathname.split("/").filter(Boolean);
    if (segments.length === 0) return "chards-coin";
    const namePart = segments[segments.length - 2] || segments[segments.length - 1];
    const idPart = segments[segments.length - 1];
    const raw = `chards-${namePart}-${idPart}`;
    return raw
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "");
  } catch {
    return "chards-coin";
  }
}

async function downloadToWebp(imgUrl, destPath) {
  const res = await fetch(imgUrl, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0 Safari/537.36",
    },
    redirect: "follow",
  });
  if (!res.ok) {
    console.log("  ! download failed:", imgUrl, res.status);
    return false;
  }
  const buf = Buffer.from(await res.arrayBuffer());
  if (!buf.length) {
    console.log("  ! empty buffer:", imgUrl);
    return false;
  }
  await sharp(buf)
    .resize(MAX_SIDE, MAX_SIDE, { fit: "inside", withoutEnlargement: true })
    .webp({ quality: 82, effort: 6, smartSubsample: true })
    .toFile(destPath);
  return true;
}

async function scrapeImagesForProduct(page, productUrl) {
  await page.goto(productUrl, { waitUntil: "domcontentloaded", timeout: 45000 });
  await page.waitForTimeout(1500);

  const imgs = await page.evaluate(() => {
    const root =
      document.querySelector('[aria-label="Image Carousel"]') || document;
    const list = Array.from(root.querySelectorAll("img"));
    const urls = list
      .map((img) => img.getAttribute("data-src") || img.getAttribute("src"))
      .filter(Boolean);
    return Array.from(new Set(urls));
  });

  if (!imgs.length) {
    console.log("  ! нет картинок в карусели");
    return { reverseUrl: null, obverseUrl: null, all: [] };
  }

  const normalized = imgs.map((u) => normalizeUrl(u)).filter(Boolean);

  const reverseUrl = normalized[0] || null;
  const obverseUrl = normalized[1] || null;

  return { reverseUrl, obverseUrl, all: normalized };
}

async function main() {
  ensureDir(OUT_DIR);
  ensureDir(DATA_DIR);

  let existing = [];
  if (fs.existsSync(OUT_JSON)) {
    try {
      existing = JSON.parse(fs.readFileSync(OUT_JSON, "utf8"));
    } catch {
      existing = [];
    }
  }
  const byUrl = new Map();
  for (const item of existing) {
    if (item && item.productUrl) byUrl.set(item.productUrl, item);
  }

  let chromium;
  try {
    // eslint-disable-next-line global-require, import/no-extraneous-dependencies
    const playwrightExtra = require("playwright-extra");
    // eslint-disable-next-line global-require, import/no-extraneous-dependencies
    chromium = playwrightExtra.chromium;
    chromium.use(require("puppeteer-extra-plugin-stealth")());
  } catch (e) {
    console.error(
      "Нужны зависимости: playwright-extra, puppeteer-extra-plugin-stealth"
    );
    process.exit(1);
  }

  const browser = await chromium.launch({
    headless: true,
    args: ["--no-sandbox"],
  });
  const page = await browser.newPage();
  page.setDefaultTimeout(45000);

  try {
    let processed = 0;
    for (const productUrl of EXTRA_URLS) {
      processed += 1;
      console.log(`\n[${processed}/${EXTRA_URLS.length}] ${productUrl}`);

      const { reverseUrl, obverseUrl, all } =
        // eslint-disable-next-line no-await-in-loop
        await scrapeImagesForProduct(page, productUrl);

      const slug = slugFromProductUrl(productUrl);

      const entry =
        byUrl.get(productUrl) ||
        {
          productUrl,
          slug,
          images: {
            reverse: null,
            obverse: null,
          },
          rawUrls: all,
        };

      entry.slug = slug;
      entry.rawUrls = all;

      if (reverseUrl) {
        const dest = path.join(OUT_DIR, `${slug}-rev.webp`);
        const rel = `/image/coins/chards-kookaburra/${slug}-rev.webp`;
        // eslint-disable-next-line no-await-in-loop
        const ok = await downloadToWebp(reverseUrl, dest);
        if (ok) {
          entry.images.reverse = rel;
          console.log("  ✓ reverse:", rel);
        }
      }

      if (obverseUrl) {
        const dest = path.join(OUT_DIR, `${slug}-obv.webp`);
        const rel = `/image/coins/chards-kookaburra/${slug}-obv.webp`;
        // eslint-disable-next-line no-await-in-loop
        const ok = await downloadToWebp(obverseUrl, dest);
        if (ok) {
          entry.images.obverse = rel;
          console.log("  ✓ obverse:", rel);
        }
      }

      byUrl.set(productUrl, entry);

      // eslint-disable-next-line no-await-in-loop
      await new Promise((res) => res && setTimeout(res, 600));
    }

    const final = Array.from(byUrl.values());
    fs.writeFileSync(OUT_JSON, JSON.stringify(final, null, 2), "utf8");
    console.log(
      `\nГотово. Всего записей в JSON: ${final.length}. Файл: ${OUT_JSON}`
    );
  } finally {
    await page.close();
    await browser.close();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

