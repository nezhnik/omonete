/**
 * Докачивает правильный реверс для золотых Discover Australia 2012
 * (Kookaburra и Goanna) и прописывает его в канонических JSON.
 *
 * Использует raw.imageUrls, выбирая URL с нужным зверем и "straight" в имени.
 *
 * Запуск: node scripts/fix-discover-australia-gold-reverse.js
 * Затем: node scripts/update-perth-from-canonical-json.js
 *        npm run data:export:incremental
 *        npm run build
 */

const fs = require("fs");
const path = require("path");
const sharp = require("sharp");

const DATA_DIR = path.join(__dirname, "..", "data");
const FOREIGN_DIR = path.join(__dirname, "..", "public", "image", "coins", "foreign");

async function downloadToWebp(url, destPath) {
  const fullUrl = url.startsWith("http") ? url : `https://www.perthmint.com${url}`;
  const res = await fetch(fullUrl, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0 Safari/537.36",
    },
    redirect: "follow",
  });
  if (!res.ok) {
    console.error("HTTP", res.status, "для", fullUrl);
    return false;
  }
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length < 1000) {
    console.error("Слишком маленький файл для", fullUrl);
    return false;
  }
  await sharp(buf)
    .resize(1200, 1200, { fit: "inside", withoutEnlargement: true })
    .webp({ quality: 82, effort: 6, smartSubsample: true })
    .toFile(destPath);
  return true;
}

async function fixOne(fileName, slugKeyword, urlKeyword) {
  const fullPath = path.join(DATA_DIR, fileName);
  if (!fs.existsSync(fullPath)) {
    console.warn("Нет файла:", fileName);
    return false;
  }
  const raw = JSON.parse(fs.readFileSync(fullPath, "utf8"));
  const urls = raw?.raw?.imageUrls;
  if (!Array.isArray(urls) || urls.length === 0) {
    console.warn("Нет raw.imageUrls для", fileName);
    return false;
  }

  // Ищем URL с нужным зверем и straight (вид монеты "в лоб").
  const lowerKey = (urlKeyword || slugKeyword).toLowerCase();
  const cand = urls.find((u) => {
    const s = String(u).toLowerCase();
    return s.includes(lowerKey) && (s.includes("straight") || s.includes("straig") || s.includes("proof"));
  });

  if (!cand) {
    console.warn("Не найден кандидат на реверс для", fileName);
    return false;
  }

  const baseName = slugKeyword; // уже полный slug без суффикса
  const destFile = `${baseName}-rev.webp`;
  const destPath = path.join(FOREIGN_DIR, destFile);

  console.log("Скачиваю реверс для", fileName, "из", cand);
  const ok = await downloadToWebp(cand, destPath);
  if (!ok) return false;

  const relPath = `/image/coins/foreign/${destFile}`;
  const prev = raw.coin?.image_reverse || null;

  raw.coin = raw.coin || {};
  raw.coin.image_reverse = relPath;
  raw.saved = raw.saved || {};
  raw.saved.reverse = relPath;

  fs.writeFileSync(fullPath, JSON.stringify(raw, null, 2), "utf8");
  console.log(`✓ ${fileName}: image_reverse "${prev || "null"}" → "${relPath}"`);
  return true;
}

async function main() {
  let okCount = 0;
  if (
    await fixOne(
      "perth-mint-discover-australia-kookaburra-2012-1-2oz-gold-proof-coin.json",
      "discover-australia-kookaburra-2012-1-2oz-gold-proof-coin",
      "discoveraustralia-kookaburra-gold-1_2oz-proof"
    )
  ) {
    okCount++;
  }
  if (
    await fixOne(
      "perth-mint-discover-australia-goanna-2012-1-2oz-gold-proof-coin.json",
      "discover-australia-goanna-2012-1-2oz-gold-proof-coin",
      "discoveraustralia-goanna-gold-1_2oz-proof"
    )
  ) {
    okCount++;
  }
  console.log(`Готово. Успешно обновлено: ${okCount} файлов. Дальше: update-perth-from-canonical-json.js → export → build.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

