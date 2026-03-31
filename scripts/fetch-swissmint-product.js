/**
 * Парсинг одной карточки Swissmint.
 */
const fs = require("fs");
const path = require("path");
const https = require("https");

const ROOT = path.join(__dirname, "..");
const DATA_DIR = path.join(ROOT, "data");
const IMG_ROOT = path.join(ROOT, "public", "image", "coins", "foreign", "swissmint");

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

function parseSpecPairs(text) {
  const out = {};
  const raw = String(text || "");
  const lines = raw
    .split("\n")
    .map((x) => x.replace(/\s+/g, " ").trim())
    .filter(Boolean);
  for (const line of lines) {
    const m = line.match(/^([^:]{2,80}):\s*(.+)$/);
    if (!m) continue;
    const key = m[1].trim();
    const val = m[2].trim();
    if (key && val && !out[key]) out[key] = val;
  }
  const pick = (label, re) => {
    if (out[label]) return;
    const m = raw.match(re);
    if (m && m[1]) out[label] = String(m[1]).replace(/\s+/g, " ").trim();
  };
  pick("Legal face value", /Legal face value:\s*([^<\n]+?)(?:\s{2,}|Alloy:|Diameter:|Weight:|Date of issue:|Mintage|Prices|$)/i);
  pick("Alloy", /Alloy:\s*([^<\n]+?)(?:\s{2,}|Diameter:|Weight:|Date of issue:|Mintage|Prices|$)/i);
  pick("Diameter", /Diameter:\s*([^<\n]+?)(?:\s{2,}|Weight:|Date of issue:|Mintage|Prices|$)/i);
  pick("Weight", /Weight:\s*([^<\n]+?)(?:\s{2,}|Date of issue:|Mintage|Prices|$)/i);
  pick("Date of issue", /Date of issue:\s*([^<\n]+?)(?:\s{2,}|Mintage|Prices|$)/i);
  pick(
    "Mintage Proof in presentation case",
    /Mintage Proof in presentation case:\s*([^<\n]+?)(?:\s{2,}|Uncirculated:|Prices|$)/i
  );
  pick("Uncirculated", /Uncirculated:\s*([^<\n]+?)(?:\s{2,}|Prices|$)/i);
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
  await page.waitForTimeout(1800);
  const parsed = await page.evaluate(() => {
    const txt = (el) => (el && el.textContent ? el.textContent.replace(/\s+/g, " ").trim() : "");
    const root =
      document.querySelector(".col-l-8.col-m-12.col-xs-12.intro-animation.intro-animation--bottom.intro-animation--visible") ||
      document.querySelector(".section") ||
      document.body;
    const imgRoot =
      document.querySelector(".col-l-4.col-m-6.col-xs-12.intro-animation.intro-animation--bottom.intro-animation--visible") ||
      document.querySelector(".section") ||
      document.body;

    const title =
      txt(root.querySelector("h1, h2, h3")) ||
      txt(document.querySelector("h1")) ||
      txt(document.querySelector("title")) ||
      null;

    const description =
      txt(
        root.querySelector(
          ".section__text.section__text--lead.section__text--center p, .section__text p, p"
        )
      ) || null;

    const specsText = txt(root);
    const imageSet = new Set();
    const nodes = [
      ...imgRoot.querySelectorAll("img[src], img[data-src], source[srcset]"),
      ...document.querySelectorAll("img[src], img[data-src], source[srcset]"),
      ...document.querySelectorAll("meta[property='og:image'][content]"),
    ];
    for (const n of nodes) {
      const vals = [
        n.getAttribute && n.getAttribute("src"),
        n.getAttribute && n.getAttribute("data-src"),
        n.getAttribute && n.getAttribute("srcset"),
        n.getAttribute && n.getAttribute("content"),
      ];
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
      description,
      specsText,
      imageUrls: Array.from(imageSet),
    };
  });

  const specs = parseSpecPairs(parsed.specsText);
  return {
    source_url: sourceUrl,
    title: parsed.title,
    description: parsed.description,
    specs,
    specsText: parsed.specsText,
    imageUrls: parsed.imageUrls.filter((u) => /sondermuenze\.ch|swissmint|\/uploads\//i.test(u)),
    parsedAt: new Date().toISOString(),
  };
}

async function saveParsed(parsed) {
  const source = normalizeUrl(parsed.source_url);
  const slug = slugFromUrl(source);
  const coinDir = path.join(IMG_ROOT, slug);
  if (!fs.existsSync(coinDir)) fs.mkdirSync(coinDir, { recursive: true });

  const local = [];
  for (let i = 0; i < (parsed.imageUrls || []).length; i++) {
    const u = parsed.imageUrls[i];
    const urlPath = (() => {
      try {
        return new URL(u).pathname;
      } catch {
        return String(u);
      }
    })();
    const extMatch = String(urlPath).match(/\.(jpg|jpeg|png|webp)$/i) || String(u).match(/\.(jpg|jpeg|png|webp)(?:$|\?)/i);
    const ext = extMatch ? extMatch[1].toLowerCase() : "jpg";
    const name = `${String(i + 1).padStart(2, "0")}.${ext}`;
    const abs = path.join(coinDir, name);
    const rel = `/image/coins/foreign/swissmint/${slug}/${name}`;
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
  const outFile = path.join(DATA_DIR, `swissmint-${slug}.json`);
  fs.writeFileSync(outFile, JSON.stringify(out, null, 2), "utf8");
  return { outFile, imageCount: local.length };
}

async function fetchOneWithPage(page, rawUrl) {
  const source = normalizeUrl(rawUrl);
  const parsed = await parseProduct(page, source);
  return saveParsed(parsed);
}

async function main() {
  const rawUrl = process.argv.find((x) => /^https?:\/\//i.test(x));
  if (!rawUrl) {
    console.error('Укажите URL: node scripts/fetch-swissmint-product.js "https://..."');
    process.exit(1);
  }
  const { chromium } = require("playwright-extra");
  const StealthPlugin = require("puppeteer-extra-plugin-stealth");
  chromium.use(StealthPlugin());
  const browser = await chromium.launch({ headless: process.env.HEADLESS !== "0", args: ["--no-sandbox"] });
  const context = await browser.newContext({
    locale: "en-US",
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    viewport: { width: 1366, height: 900 },
  });
  const page = await context.newPage();
  const result = await fetchOneWithPage(page, rawUrl);
  await browser.close();
  console.log("Готово:", result.outFile, "Картинок:", result.imageCount);
}

module.exports = { normalizeUrl, slugFromUrl, parseProduct, fetchOneWithPage };

if (require.main === module) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}

