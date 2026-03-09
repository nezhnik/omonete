/**
 * Парсит HTML страницы поиска BullionStar kookaburra, извлекает монеты,
 * исключает "Various Years", скачивает obverse+reverse для недостающих.
 * Обновляет план названиями (title) где пусто.
 *
 * Запуск:
 *   node scripts/parse-bullionstar-search-and-download.js data/bullionstar-search-kookaburra.html
 *   node scripts/parse-bullionstar-search-and-download.js --stdin  (читать HTML из stdin)
 */

/* eslint-disable no-console */

const fs = require("fs");
const path = require("path");
const sharp = require("sharp");

const STATIC = "https://static.bullionstar.com";
const PROJECT_ROOT = path.join(__dirname, "..");
const OUT_DIR = path.join(PROJECT_ROOT, "public", "image", "coins", "bullionstar-kookaburra");
const DATA_DIR = path.join(PROJECT_ROOT, "data");
const PLAN_PATH = path.join(
  "/Users/mihail/Desktop/Нумизматика сайт",
  "Файлы и документы по монетам",
  "кукабарра",
  "KOOKABURRA_SERIES_PLAN.md"
);
const MAX_SIDE = 1200;

function ensureDir(d) {
  if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
}

/** Парсит .item из HTML поиска BullionStar */
function parseItems(html) {
  const items = [];
  const blocks = html.split(/<div class="item\s/);
  for (let i = 1; i < blocks.length; i++) {
    const block = blocks[i];
    const hrefM = block.match(/href="([^"]+)"/);
    const imgM = block.match(/<img[^>]+src="([^"]+)"/);
    const nameM = block.match(/<span class="name">([^<]+)<\/span>/);
    if (!hrefM || !imgM || !nameM) continue;
    const name = nameM[1].trim();
    if (/various\s*years/i.test(name)) continue;
    items.push({
      href: hrefM[1].split("?")[0],
      imgSrc: imgM[1],
      name,
    });
  }
  return items;
}

/** Извлекает year и weight из названия: "1992 2 oz...", "2010 1 Kilogram...", "2024 1/10 oz..." */
function parseTitle(name) {
  const yearM = name.match(/(\d{4})\s/);
  const year = yearM ? parseInt(yearM[1], 10) : null;
  let weight = "1oz";
  if (/\d+\s*kg|kilogram/i.test(name)) weight = "1kg";
  else if (/\b10\s*oz/i.test(name)) weight = "10oz";
  else if (/\b2\s*oz/i.test(name)) weight = "2oz";
  else if (/\b1\/10\s*oz/i.test(name)) weight = "0.1oz";
  else if (/\b1\s*oz/i.test(name)) weight = "1oz";
  return { year, weight };
}

/** 100_100 -> 1200_1200 для полного размера */
function toFullSizeUrl(url) {
  if (!url) return null;
  return url.replace(/\d+_\d+_/, "1200_1200_");
}

/** Какие файлы уже есть в bullionstar-kookaburra (по year-weight) */
function existingFiles() {
  const byKey = new Set();
  if (!fs.existsSync(OUT_DIR)) return byKey;
  for (const f of fs.readdirSync(OUT_DIR)) {
    const m = f.match(/bullionstar-kookaburra-(\d+oz|\d+kg)-(\d{4})-(obv|rev)\.webp/i) ||
      f.match(/bullionstar-.*?(\d+)(?:oz|kg).*?-(\d{4})-(obv|rev)\.webp/i);
    if (m) byKey.add(`${m[2]}-${m[1]}`);
  }
  return byKey;
}

/** Нормализует weight для ключа: 1oz, 2oz, 10oz, 1kg */
function normWeight(w) {
  if (!w) return "1oz";
  const s = String(w).toLowerCase().replace(/\s/g, "");
  if (/1kg|kilogram/.test(s)) return "1kg";
  if (/10oz|10-oz/.test(s)) return "10oz";
  if (/2oz|2-oz/.test(s)) return "2oz";
  if (/1\/10/.test(s)) return "0.1oz";
  return s.replace(/[^0-9oz.-]/g, "") || "1oz";
}

async function fetchHtml(url) {
  const res = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0 Chrome/120.0.0.0", Accept: "text/html" },
    redirect: "follow",
  });
  return res.ok ? res.text() : null;
}

/** Извлекает obverse и reverse из HTML продукта */
function extractImagesFromProduct(html) {
  const urls = { obverse: null, reverse: null };
  if (!html) return urls;
  const all = html.match(/https:\/\/static\.bullionstar\.com\/files\/[^"'\s]+\.webp/gi) || [];
  for (const u of [...new Set(all)]) {
    const big = u.replace(/\d+_\d+_/, "1200_1200_");
    if ((/obverse|front/i.test(u)) && !urls.obverse) urls.obverse = big;
    if ((/reverse|back/i.test(u)) && !urls.reverse) urls.reverse = big;
  }
  return urls;
}

async function downloadToWebp(imgUrl, destPath, skipIfExists = true) {
  if (skipIfExists && fs.existsSync(destPath)) return true;
  try {
    const res = await fetch(imgUrl, {
      headers: { "User-Agent": "Mozilla/5.0 Chrome/120.0.0.0" },
      redirect: "follow",
    });
    if (!res.ok) return false;
    const buf = Buffer.from(await res.arrayBuffer());
    if (!buf.length) return false;
    await sharp(buf)
      .resize(MAX_SIDE, MAX_SIDE, { fit: "inside", withoutEnlargement: true })
      .webp({ quality: 82, effort: 6 })
      .toFile(destPath);
    return true;
  } catch {
    return false;
  }
}

function fileSlug(year, weight, suffix) {
  const w = normWeight(weight).replace(/[^a-z0-9.-]/g, "");
  return `bullionstar-kookaburra-${w}-${year}-${suffix}.webp`;
}

function filePath(year, weight, suffix) {
  return path.join(OUT_DIR, fileSlug(year, weight, suffix));
}

async function main() {
  let html;
  const stdin = process.argv.includes("--stdin");
  const fileArg = process.argv.find((a) => a.endsWith(".html"));
  if (stdin) {
    html = await new Promise((r) => {
      let d = "";
      process.stdin.on("data", (c) => (d += c));
      process.stdin.on("end", () => r(d));
    });
  } else if (fileArg && fs.existsSync(fileArg)) {
    html = fs.readFileSync(fileArg, "utf8");
  } else {
    console.error("Укажи файл: node parse-bullionstar-search-and-download.js data/bullionstar-search-kookaburra.html");
    console.error("Или: node parse-bullionstar-search-and-download.js --stdin < search.html");
    process.exit(1);
  }

  const items = parseItems(html);
  console.log("Найдено монет (без Various Years):", items.length);

  const existing = existingFiles();
  const results = [];
  ensureDir(OUT_DIR);
  ensureDir(DATA_DIR);

  for (let i = 0; i < items.length; i++) {
    const { href, imgSrc, name } = items[i];
    const { year, weight } = parseTitle(name);
    const wNorm = normWeight(weight);
    const key = `${year}-${wNorm}`;

    const productUrl = href.startsWith("http") ? href : `https://www.bullionstar.com${href}`;
    const thumbFull = toFullSizeUrl(imgSrc);

    const entry = {
      name,
      year,
      weight: wNorm,
      productUrl,
      thumbUrl: thumbFull,
      obverse: null,
      reverse: null,
      downloaded: false,
    };

    const obvPath = filePath(year, wNorm, "obv");
    const revPath = filePath(year, wNorm, "rev");
    const hasObv = fs.existsSync(obvPath);
    const hasRev = fs.existsSync(revPath);

    if (hasObv && hasRev) {
      console.log(`[${i + 1}/${items.length}] ${year} ${wNorm} — уже есть`);
      results.push(entry);
      continue;
    }

    console.log(`[${i + 1}/${items.length}] ${year} ${wNorm} ${name.slice(0, 50)}...`);

    const pageHtml = await fetchHtml(productUrl);
    const imgs = extractImagesFromProduct(pageHtml);
    if (!imgs.obverse) imgs.obverse = thumbFull && /obverse|front/i.test(thumbFull) ? thumbFull : thumbFull;
    if (!imgs.reverse) imgs.reverse = thumbFull && /reverse|back/i.test(thumbFull) ? thumbFull : null;

    if (imgs.obverse && !hasObv) {
      const ok = await downloadToWebp(imgs.obverse, obvPath, true);
      if (ok) {
        entry.obverse = `/image/coins/bullionstar-kookaburra/${path.basename(obvPath)}`;
        entry.downloaded = true;
        console.log("  ✓ obverse");
      }
    }
    if (imgs.reverse && !hasRev) {
      const ok = await downloadToWebp(imgs.reverse, revPath, true);
      if (ok) {
        entry.reverse = `/image/coins/bullionstar-kookaburra/${path.basename(revPath)}`;
        entry.downloaded = true;
        console.log("  ✓ reverse");
      }
    }

    results.push(entry);
    await new Promise((r) => setTimeout(r, 400));
  }

  const outPath = path.join(DATA_DIR, "bullionstar-kookaburra-parsed.json");
  fs.writeFileSync(outPath, JSON.stringify(results, null, 2), "utf8");
  console.log("\nГотово. Результаты:", outPath);
  console.log("Скачано новых:", results.filter((r) => r.downloaded).length);
  console.log("Названия для плана (title):", results.map((r) => ({ year: r.year, weight: r.weight, title: r.name })));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
