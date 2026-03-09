/**
 * Скрейпит Kookaburra с BullionStar (работает через fetch — картинки в HTML).
 *  - Сверяется с KOOKABURRA_SERIES_PLAN.md: берём ТОЛЬКО монеты без has_images;
 *  - не перезаписывает существующие файлы;
 *  - front = obverse, back = reverse;
 *  - сохраняем в public/image/coins/bullionstar-kookaburra;
 *
 * Запуск:
 *   node scripts/scrape-bullionstar-kookaburra-images.js
 *   node scripts/scrape-bullionstar-kookaburra-images.js --force  (игнорировать «уже есть»)
 */

/* eslint-disable no-console */

const fs = require("fs");
const path = require("path");
const sharp = require("sharp");

const BASE = "https://www.bullionstar.com/buy/product";
const STATIC = "https://static.bullionstar.com";

const PROJECT_ROOT = path.join(__dirname, "..");
const DATA_DIR = path.join(PROJECT_ROOT, "data");
const PUBLIC_DIR = path.join(PROJECT_ROOT, "public");
const OUT_DIR = path.join(PUBLIC_DIR, "image", "coins", "bullionstar-kookaburra");
const OUT_JSON = path.join(DATA_DIR, "bullionstar-kookaburra-raw.json");

const MAX_SIDE = 1200;

const PLAN_PATH = path.join(
  "/Users/mihail/Desktop/Нумизматика сайт",
  "Файлы и документы по монетам",
  "кукабарра",
  "KOOKABURRA_SERIES_PLAN.md"
);

/** Загружает ключи "1oz-YYYY" для regular-1oz БЕЗ has_images из плана */
function loadMissing1ozFromPlan() {
  if (!fs.existsSync(PLAN_PATH)) return new Set();
  const text = fs.readFileSync(PLAN_PATH, "utf8");
  const lines = text.split(/\r?\n/);
  const missing = new Set();

  for (const line of lines) {
    if (!line.startsWith("|")) continue;
    if (line.startsWith("| year") || line.startsWith("|------")) continue;
    const cells = line.split("|").slice(1, -1).map((c) => c.trim());
    if (cells.length !== 16) continue;

    const [yearStr, type, variant] = cells;
    const hasImages = cells[13];
    const year = parseInt(yearStr, 10);

    if (type !== "regular-1oz" || variant || !year || hasImages) continue;
    missing.add(`1oz-${year}`);
  }
  return missing;
}

// Варианты slug — BullionStar меняет формат по годам
function productSlugs1oz(year) {
  const y = Number(year);
  return [
    `silver-coin-australia-kookaburra-${y}-1oz`,
    `silver-coin-australia-kookaburra-1oz-${y}`,
    `silver-kookaburra-${y}-1oz`,
  ];
}

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function fullUrl(slug) {
  return slug.startsWith("http") ? slug : `${BASE}/${slug}`;
}

function slugFromProduct(slug) {
  return `bullionstar-${slug}`.replace(/[^a-z0-9-]/g, "-").replace(/-+/g, "-");
}

async function fetchHtml(url) {
  const res = await fetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0 Safari/537.36",
      Accept: "text/html",
    },
    redirect: "follow",
  });
  if (!res.ok) return null;
  return res.text();
}

function extractImages(html) {
  const urls = { obverse: null, reverse: null };
  if (!html) return urls;

  const all = html.match(/https:\/\/static\.bullionstar\.com\/files\/silver-coins\/australian-kookaburra\/[^"'\s]+bullionstar-(front|back)[^"'\s]*\.webp/gi) || [];
  const front = all.filter((u) => /bullionstar-front/i.test(u));
  const back = all.filter((u) => /bullionstar-back/i.test(u));

  if (front.length) urls.obverse = front.find((u) => u.includes("1200")) || front.find((u) => u.includes("600")) || front[0];
  if (back.length) urls.reverse = back.find((u) => u.includes("1200")) || back.find((u) => u.includes("600")) || back[0];

  return urls;
}

async function downloadToWebp(imgUrl, destPath, skipIfExists = true) {
  if (skipIfExists && fs.existsSync(destPath)) return true;
  try {
    const res = await fetch(imgUrl, {
      headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0 Safari/537.36" },
      redirect: "follow",
    });
    if (!res.ok) return false;
    const buf = Buffer.from(await res.arrayBuffer());
    if (!buf.length) return false;
    await sharp(buf)
      .resize(MAX_SIDE, MAX_SIDE, { fit: "inside", withoutEnlargement: true })
      .webp({ quality: 82, effort: 6, smartSubsample: true })
      .toFile(destPath);
    return true;
  } catch {
    return false;
  }
}

async function main() {
  ensureDir(OUT_DIR);
  ensureDir(DATA_DIR);

  const force = process.argv.includes("--force");
  const limitArg = process.argv.find((a) => a.startsWith("--limit="));
  const limit = limitArg ? parseInt(limitArg.split("=")[1], 10) || 0 : 0;

  const missing = loadMissing1ozFromPlan();
  const years = [];
  for (let y = 1990; y <= 2026; y++) {
    if (!force && !missing.has(`1oz-${y}`)) continue;
    years.push(y);
  }

  if (years.length === 0) {
    console.log("Нет недостающих 1oz в плане (has_images уже заполнен). Используй --force для игнора.");
    return;
  }
  console.log("Недостающие 1oz по плану:", years.length, "годы:", years.slice(0, 15).join(", "), years.length > 15 ? "..." : "");

  const target = limit > 0 ? years.slice(0, limit) : years;
  const out = [];
  let okCount = 0;

  for (let i = 0; i < target.length; i++) {
    const year = target[i];
    const slugVariants = productSlugs1oz(year);
    let imgs = { obverse: null, reverse: null };
    let url = fullUrl(slugVariants[0]);

    for (const slug of slugVariants) {
      const u = fullUrl(slug);
      const html = await fetchHtml(u);
      const extracted = extractImages(html);
      if (extracted.obverse || extracted.reverse) {
        imgs = extracted;
        url = u;
        break;
      }
    }

    const fileSlug = slugFromProduct(`kookaburra-1oz-${year}`);
    console.log(`[${i + 1}/${target.length}] ${year} ${url}`);

    const entry = {
      year,
      productUrl: url,
      slug: fileSlug,
      images: { reverse: null, obverse: null },
      rawUrls: { obverse: imgs.obverse, reverse: imgs.reverse },
    };

    if (imgs.reverse) {
      const dest = path.join(OUT_DIR, `${fileSlug}-rev.webp`);
      const rel = `/image/coins/bullionstar-kookaburra/${fileSlug}-rev.webp`;
      const ok = await downloadToWebp(imgs.reverse, dest, !force);
      if (ok) {
        entry.images.reverse = rel;
        okCount++;
        console.log("  ✓ reverse");
      }
    }
    if (imgs.obverse) {
      const dest = path.join(OUT_DIR, `${fileSlug}-obv.webp`);
      const rel = `/image/coins/bullionstar-kookaburra/${fileSlug}-obv.webp`;
      const ok = await downloadToWebp(imgs.obverse, dest, !force);
      if (ok) {
        entry.images.obverse = rel;
        console.log("  ✓ obverse");
      }
    }

    out.push(entry);
    await new Promise((r) => setTimeout(r, 400));
  }

  fs.writeFileSync(OUT_JSON, JSON.stringify(out, null, 2), "utf8");
  console.log(`\nГотово. OK: ${okCount}, JSON: ${OUT_JSON}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
