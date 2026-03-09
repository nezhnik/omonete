/**
 * Точечный фикс реверса для One Love 2020 1oz Silver Proof Coin.
 *
 * Берём первый URL из raw.imageUrls (straighton) как реверс,
 * скачиваем, конвертируем в webp и прописываем в image_reverse.
 *
 * Запуск:
 *   node scripts/fix-one-love-2020-reverse.js
 * Затем:
 *   node scripts/update-perth-from-canonical-json.js
 *   npm run data:export:incremental
 *   npm run build
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

async function main() {
  const fileName = "perth-mint-one-love-2020-1oz-silver-proof-coin.json";
  const full = path.join(DATA_DIR, fileName);
  if (!fs.existsSync(full)) {
    console.error("Файл не найден:", fileName);
    process.exit(1);
  }
  const json = JSON.parse(fs.readFileSync(full, "utf8"));
  const urls = json?.raw?.imageUrls;
  if (!Array.isArray(urls) || urls.length === 0) {
    console.error("Нет raw.imageUrls для One Love 2020");
    process.exit(1);
  }

  // Берём первый URL (straighton) как реверс.
  const revUrl = urls[0];
  const destFile = "one-love-2020-1oz-silver-proof-coin-rev.webp";
  const destPath = path.join(FOREIGN_DIR, destFile);

  console.log("Скачиваю реверс для One Love 2020 из", revUrl);
  const ok = await downloadToWebp(revUrl, destPath);
  if (!ok) {
    console.error("Не удалось скачать/сконвертировать реверс");
    process.exit(1);
  }

  const relPath = `/image/coins/foreign/${destFile}`;
  const prev = json.coin?.image_reverse || null;
  json.coin = json.coin || {};
  json.coin.image_reverse = relPath;
  json.saved = json.saved || {};
  json.saved.reverse = relPath;

  fs.writeFileSync(full, JSON.stringify(json, null, 2), "utf8");
  console.log(`✓ ${fileName}: image_reverse "${prev || "null"}" → "${relPath}"`);
  console.log("Готово. Дальше: update-perth-from-canonical-json.js → export → build.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

