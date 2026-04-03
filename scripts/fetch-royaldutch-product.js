/**
 * Парсинг одной карточки Royal Dutch Mint.
 * Сохраняет data/royaldutch-mint-<slug>.json и качает изображения в public/image/coins/foreign/royaldutch/<slug>/.
 */
const fs = require("fs");
const path = require("path");
const https = require("https");

const ROOT = path.join(__dirname, "..");
const DATA_DIR = path.join(ROOT, "data");
const IMG_DIR = path.join(ROOT, "public", "image", "coins", "foreign", "royaldutch");

function normalizeUrl(raw) {
  const u = new URL(raw);
  u.hash = "";
  u.search = "";
  return `${u.origin}${u.pathname}`.replace(/\/+$/, "");
}

function slugFromUrl(url) {
  const u = new URL(url);
  const seg = u.pathname.split("/").filter(Boolean).pop() || "item";
  return seg.toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
}

function parseSpecPairs(raw) {
  const out = {};
  const lines = String(raw || "")
    .split("\n")
    .map((x) => x.replace(/\s+/g, " ").trim())
    .filter(Boolean);
  for (let i = 0; i + 1 < lines.length; i += 2) {
    const k = lines[i].replace(/:$/, "").trim();
    const v = lines[i + 1];
    if (k && v && !out[k]) out[k] = v;
  }
  return out;
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
    req.on("error", () => resolve(false));
    req.on("timeout", () => {
      req.destroy();
      resolve(false);
    });
  });
}

async function parseProduct(page, sourceUrl) {
  await page.goto(sourceUrl, { waitUntil: "domcontentloaded", timeout: 120000 });
  await page.waitForSelector("img.fotorama__img, .fotorama img", { state: "attached", timeout: 25000 }).catch(() => {});
  await page.waitForTimeout(1200);

  const parsed = await page.evaluate(() => {
    const txt = (el) => (el && el.textContent ? el.textContent.replace(/\s+/g, " ").trim() : "");
    const title =
      txt(document.querySelector(".amtheme-product-info h1, .amtheme-product-info .page-title span")) ||
      txt(document.querySelector("h1")) ||
      null;
    const price = txt(document.querySelector(".amtheme-product-info .price, .price-box .price"));

    const desc =
      txt(document.querySelector(".product.attribute.description .value")) ||
      txt(document.querySelector(".product.attribute.description")) ||
      null;

    const table =
      document.querySelector(".additional-attributes-wrapper .table-wrapper table.additional-attributes") ||
      document.querySelector("table.additional-attributes");
    const tableText = txt(table);
    const specsText = tableText || "";
    const specs = {};
    const rows = table ? Array.from(table.querySelectorAll("tr")) : [];
    for (const tr of rows) {
      const k =
        txt(tr.querySelector("th")) ||
        txt(tr.querySelector(".label")) ||
        txt(tr.children && tr.children[0]);
      const v =
        txt(tr.querySelector("td")) ||
        txt(tr.querySelector(".data")) ||
        txt(tr.children && tr.children[1]);
      if (k && v && !specs[k]) specs[k] = v;
    }

    const imageSet = new Set();
    const nodes = [
      ...document.querySelectorAll(".fotorama__stage__frame img"),
      ...document.querySelectorAll(".fotorama__nav-wrap img"),
      ...document.querySelectorAll(".fotorama img"),
    ];
    for (const n of nodes) {
      const vals = [n.getAttribute("src"), n.getAttribute("data-src"), n.getAttribute("srcset")];
      for (const v of vals) {
        if (!v) continue;
        for (const part of String(v).split(",")) {
          const u = part.trim().split(" ")[0];
          if (!u) continue;
          if (/^https?:\/\//i.test(u)) imageSet.add(u);
          else if (u.startsWith("//")) imageSet.add("https:" + u);
          else if (u.startsWith("/")) imageSet.add(location.origin + u);
        }
      }
    }

    return {
      title,
      price_display: price || null,
      description: desc,
      specsText,
      specs,
      imageUrls: Array.from(imageSet),
    };
  });

  return {
    source_url: sourceUrl,
    title: parsed.title,
    price_display: parsed.price_display,
    description: parsed.description,
    specs: Object.keys(parsed.specs || {}).length ? parsed.specs : parseSpecPairs(parsed.specsText),
    imageUrls: parsed.imageUrls.filter((u) => /royaldutchmint\.com|\/media\//i.test(u)),
    parsedAt: new Date().toISOString(),
  };
}

async function saveParsed(parsed) {
  const source = normalizeUrl(parsed.source_url);
  const slug = slugFromUrl(source);
  const coinDir = path.join(IMG_DIR, slug);
  if (!fs.existsSync(coinDir)) fs.mkdirSync(coinDir, { recursive: true });

  const local = [];
  for (let i = 0; i < (parsed.imageUrls || []).length; i++) {
    const u = parsed.imageUrls[i];
    const extMatch = String(u).match(/\.(jpg|jpeg|png|webp)(?:$|\?)/i);
    const ext = extMatch ? extMatch[1].toLowerCase() : "jpg";
    const fn = `${String(i + 1).padStart(2, "0")}.${ext}`;
    const abs = path.join(coinDir, fn);
    const rel = `/image/coins/foreign/royaldutch/${slug}/${fn}`;
    if (await download(u, abs)) local.push(rel);
  }

  const out = {
    coin: {
      ...parsed,
      source_url: source,
      slug,
      imageUrls: local,
      image_obverse: local[0] || null,
      image_reverse: local[1] || local[0] || null,
    },
  };
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  const outFile = path.join(DATA_DIR, `royaldutch-mint-${slug}.json`);
  fs.writeFileSync(outFile, JSON.stringify(out, null, 2), "utf8");
  return { outFile, imageCount: local.length };
}

async function fetchOneWithPage(page, rawUrl) {
  const source = normalizeUrl(rawUrl);
  const parsed = await parseProduct(page, source);
  return saveParsed(parsed);
}

async function main() {
  const rawUrl = process.argv.find((a) => /^https?:\/\//i.test(a));
  if (!rawUrl) {
    console.error('Укажите URL: node scripts/fetch-royaldutch-product.js "https://..."');
    process.exit(1);
  }
  const { chromium } = require("playwright-extra");
  const StealthPlugin = require("puppeteer-extra-plugin-stealth");
  chromium.use(StealthPlugin());
  const browser = await chromium.launch({ headless: process.env.HEADLESS !== "0", args: ["--no-sandbox"] });
  const context = await browser.newContext({
    locale: "en-GB",
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    viewport: { width: 1400, height: 900 },
  });
  const page = await context.newPage();
  const r = await fetchOneWithPage(page, rawUrl);
  await browser.close();
  console.log("Готово:", r.outFile, "Картинок:", r.imageCount);
}

module.exports = { normalizeUrl, slugFromUrl, parseProduct, fetchOneWithPage };

if (require.main === module) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}

