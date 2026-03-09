/**
 * Точечная перезагрузка картинок для Australian Kookaburra 2018 1oz Silver Two-Coin Set (id 5821).
 * В канонике в imageUrls попали чужие картинки; правильные — только из папки 18122zaaa:
 *   01-2018-kookaburra-1oz-silver-proof-onedge → obv
 *   02-2018-kookaburra-1oz-silver-proof-straighton → rev
 * Перезаписывает файлы в public/image/coins/foreign/.
 *
 * Запуск: node scripts/redownload-5821-two-coin-set.js
 */
const fs = require("fs");
const path = require("path");
const sharp = require("sharp");

const DATA_DIR = path.join(__dirname, "..", "data");
const FOREIGN_DIR = path.join(__dirname, "..", "public", "image", "coins", "foreign");
const BASE_URL = "https://www.perthmint.com";
const JSON_FILE = path.join(DATA_DIR, "perth-mint-australian-kookaburra-2018-1oz-silver-two-coin-set.json");
const SLUG = "australian-kookaburra-2018-1oz-silver-two-coin-set";
const PRODUCT_FOLDER = "18122zaaa";

async function downloadAndSave(imgUrl, destPath) {
  const url = imgUrl.startsWith("http") ? imgUrl : BASE_URL + imgUrl;
  const fullUrl = url.replace(/width=\d+/gi, "width=2000");
  const res = await fetch(fullUrl, {
    headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0 Safari/537.36" },
    redirect: "follow",
  });
  if (!res.ok) {
    console.warn("HTTP", res.status, fullUrl.slice(0, 80));
    return false;
  }
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length < 1000) return false;
  await sharp(buf)
    .resize(1200, 1200, { fit: "inside", withoutEnlargement: true })
    .webp({ quality: 82, effort: 6, smartSubsample: true })
    .toFile(destPath);
  return true;
}

async function main() {
  const raw = JSON.parse(fs.readFileSync(JSON_FILE, "utf8"));
  const urls = raw?.raw?.imageUrls || [];
  const productUrls = urls.filter((u) => u && String(u).includes(PRODUCT_FOLDER));
  const url01 = productUrls.find((u) => u.includes("01-2018-kookaburra") && u.includes("onedge"));
  const url02 = productUrls.find((u) => u.includes("02-2018-kookaburra") && u.includes("straighton"));
  if (!url01 || !url02) {
    console.error("Не найдены URL 01 (onedge) или 02 (straighton) в", PRODUCT_FOLDER);
    console.log("Доступные URL продукта:", productUrls.map((u) => u.split("/").pop()).slice(0, 8));
    process.exit(1);
  }
  const obvPath = path.join(FOREIGN_DIR, `${SLUG}-obv.webp`);
  const revPath = path.join(FOREIGN_DIR, `${SLUG}-rev.webp`);
  console.log("Скачиваю obv (01 onedge)...");
  const ok1 = await downloadAndSave(url01, obvPath);
  console.log("Скачиваю rev (02 straighton)...");
  const ok2 = await downloadAndSave(url02, revPath);
  if (ok1 && ok2) console.log("Готово. Файлы перезаписаны:", obvPath, revPath);
  else console.warn("Обновлено:", ok1 ? "obv" : "", ok2 ? "rev" : "");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
