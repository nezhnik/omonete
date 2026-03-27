/**
 * Парсинг одного слитка Germania Mint (карточка товара из all-bars).
 *
 * Запуск:
 *   node scripts/fetch-germania-mint-bar.js "https://germaniamint.com/all-bars/.../"
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
  return parts[parts.length - 1] || "bar";
}

async function parseGermaniaBar(page, sourceUrl) {
  return page.evaluate((sourceUrlInPage) => {
    const text = (el) => (el && el.textContent ? el.textContent.trim() : "");
    const clean = (v) =>
      String(v || "")
        .replace(/\bWe value your privacy\b/gi, "")
        .replace(/\s+/g, " ")
        .trim();

    const title = clean(text(document.querySelector("h1")) || text(document.querySelector("title")));
    const subtitle = clean(text(document.querySelector("h2")) || text(document.querySelector("h1 + p")));
    let fullTitle =
      title && subtitle && !title.toLowerCase().includes(subtitle.toLowerCase())
        ? `${title} ${subtitle}`.replace(/\s+/g, " ").trim()
        : title;
    const fromUrl = (() => {
      const m = String(sourceUrlInPage || "").match(
        /\/all-bars\/norse-gods\/norse-gods-([a-z0-9-]+)-1-oz-special-edition\/?$/i
      );
      if (!m) return null;
      const god = m[1]
        .split("-")
        .filter(Boolean)
        .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
        .join(" ");
      return god ? `Norse Gods: ${god} 1 oz Special Edition` : null;
    })();
    if (/^norse gods:\s*packaging$/i.test(fullTitle) && fromUrl) fullTitle = fromUrl;

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
    const productImagesBlock = document.querySelector(".product-images");
    if (productImagesBlock) {
      const imgs = Array.from(productImagesBlock.querySelectorAll("img"));
      obverse = getImgUrl(imgs[0]) || null;
      reverse = getImgUrl(imgs[1]) || null;
    }
    if (!obverse) obverse = getImgUrl(document.querySelector("img.coin-face-obverse")) || null;
    if (!reverse) reverse = getImgUrl(document.querySelector("img.coin-face-reverse")) || null;
    if (!reverse && obverse) reverse = obverse;

    const galleryImages = Array.from(document.querySelectorAll("a[href]"))
      .map((a) => a.getAttribute("href") || "")
      .filter(
        (href) =>
          /^https:\/\/germaniamint\.com\/wp-content\/uploads\//i.test(href) &&
          /\.(jpe?g|png|webp)$/i.test(href)
      );

    const imageUrls = Array.from(new Set([obverse, reverse, ...galleryImages].filter(Boolean)));
    return {
      source_url: sourceUrlInPage,
      title: fullTitle || null,
      specs,
      classified: {
        obverse: obverse || null,
        reverse: reverse || null,
      },
      imageUrls,
      parsedAt: new Date().toISOString(),
    };
  }, sourceUrl);
}

async function main() {
  const rawUrl = process.argv.find((a) => a.startsWith("http"));
  if (!rawUrl) {
    console.error('Передайте URL: node scripts/fetch-germania-mint-bar.js "https://germaniamint.com/all-bars/.../"');
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
    parsed = await parseGermaniaBar(page, sourceUrl);
  } finally {
    await browser.close();
  }

  const slug = slugFromUrl(sourceUrl);
  const outFile = path.join(DATA_DIR, `germania-mint-bar-${slug}.json`);
  fs.writeFileSync(outFile, JSON.stringify(parsed, null, 2), "utf8");
  console.log("Сохранено:", outFile);
  console.log("Title:", parsed.title || "—");
  console.log("Specs keys:", Object.keys(parsed.specs || {}).length);
  console.log("Images:", (parsed.imageUrls || []).length);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

