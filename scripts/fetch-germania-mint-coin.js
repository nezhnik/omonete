/**
 * Парсинг одной монеты Germania Mint (карточка товара).
 *
 * Основной источник характеристик:
 * - блок `.table.items-start` (по подсказке пользователя).
 *
 * Запуск:
 *   npm run germania:fetch -- "https://germaniamint.com/all-coins/.../"
 */
const fs = require("fs");
const path = require("path");

const DATA_DIR = path.join(__dirname, "..", "data");

function normalizeUrl(raw) {
  const u = new URL(raw);
  u.hash = "";
  return u.toString().replace(/\/$/, "");
}

function slugFromUrl(url) {
  const u = new URL(url);
  const parts = u.pathname.split("/").filter(Boolean);
  return parts[parts.length - 1] || "coin";
}

async function parseGermaniaCoin(page, sourceUrl) {
  return page.evaluate((sourceUrlInPage) => {
    const text = (el) => (el && el.textContent ? el.textContent.trim() : "");

    const title =
      text(document.querySelector("h1")) ||
      text(document.querySelector(".single-product h1")) ||
      text(document.querySelector("title"));

    const subtitle =
      text(document.querySelector("h1 + p")) ||
      text(document.querySelector(".single-product p")) ||
      null;

    const specs = {};
    const table = document.querySelector(".table.items-start");
    if (table) {
      const rows = Array.from(table.querySelectorAll(".tr"));
      rows.forEach((row) => {
        const cells = row.querySelectorAll(".td");
        const key = text(cells[0]).replace(/:$/, "");
        const value = text(cells[1]);
        if (key) specs[key] = value || null;
      });
    }

    const getImgUrl = (img) =>
      (img &&
        (img.getAttribute("src") ||
          img.getAttribute("data-src") ||
          img.getAttribute("data-lazy-src") ||
          "")) ||
      "";

    let obverse = null;
    let reverse = null;

    // Приоритетный блок по селектору пользователя:
    // .flex.justify-between.mb-14.sm:pb-14.product-images.gap-14.md:gap-10
    const productImagesBlock = document.querySelector(".product-images");
    if (productImagesBlock) {
      const obvImg = productImagesBlock.querySelector("img.coin-face-obverse");
      const revImg = productImagesBlock.querySelector("img.coin-face-reverse");
      obverse = getImgUrl(obvImg) || null;
      reverse = getImgUrl(revImg) || null;

      // Fallback: если классов нет, берём первые 2 картинки внутри блока.
      if (!obverse || !reverse) {
        const imgs = Array.from(productImagesBlock.querySelectorAll("img"));
        if (!obverse && imgs[0]) obverse = getImgUrl(imgs[0]) || null;
        if (!reverse && imgs[1]) reverse = getImgUrl(imgs[1]) || null;
      }
    }

    // Доп. fallback на случай изменений верстки.
    if (!obverse) {
      obverse =
        getImgUrl(document.querySelector("img.coin-face-obverse")) ||
        getImgUrl(document.querySelector(".image-product img")) ||
        null;
    }
    if (!reverse) {
      reverse =
        getImgUrl(document.querySelector("img.coin-face-reverse")) ||
        getImgUrl(document.querySelectorAll(".image-product img")[1]) ||
        null;
    }

    const heroImages = [obverse, reverse].filter(Boolean);

    const galleryImages = Array.from(document.querySelectorAll("a[href]"))
      .map((a) => a.getAttribute("href") || "")
      .filter(
        (href) =>
          /^https:\/\/germaniamint\.com\/wp-content\/uploads\//i.test(href) &&
          /\.(jpe?g|png|webp)$/i.test(href)
      );

    const imageUrls = Array.from(new Set([...heroImages, ...galleryImages]));

    return {
      source_url: sourceUrlInPage,
      title: title || null,
      subtitle: subtitle || null,
      specs,
      classified: {
        obverse,
        reverse,
      },
      imageUrls,
      parsedAt: new Date().toISOString(),
    };
  }, sourceUrl);
}

async function main() {
  const rawUrl = process.argv.find((a) => a.startsWith("http"));
  if (!rawUrl) {
    console.error("Передайте URL: npm run germania:fetch -- \"https://germaniamint.com/all-coins/.../\"");
    process.exit(1);
  }

  const sourceUrl = normalizeUrl(rawUrl);
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

  const { chromium } = require("playwright");
  const browser = await chromium.launch({
    headless: process.env.HEADLESS !== "0",
    args: ["--no-sandbox"],
  });

  const context = await browser.newContext({
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    viewport: { width: 1366, height: 900 },
  });
  const page = await context.newPage();

  let parsed;
  try {
    await page.goto(sourceUrl, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForTimeout(1500);
    parsed = await parseGermaniaCoin(page, sourceUrl);
  } finally {
    await browser.close();
  }

  const slug = slugFromUrl(sourceUrl);
  const outFile = path.join(DATA_DIR, `germania-mint-${slug}.json`);
  fs.writeFileSync(outFile, JSON.stringify(parsed, null, 2), "utf8");

  console.log("Сохранено:", outFile);
  console.log("Title:", parsed.title || "—");
  console.log("Specs keys:", Object.keys(parsed.specs).length);
  console.log("Obverse:", parsed.classified?.obverse || "—");
  console.log("Reverse:", parsed.classified?.reverse || "—");
  console.log("Images:", parsed.imageUrls.length);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
