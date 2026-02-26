/**
 * Обрезает белые поля у уже скачанных картинок в public/image/coins/.
 * Обрезка по белому: ищем bounding box всех «не белых» пикселей и вырезаем его.
 * Запуск: node scripts/trim-coin-images.js
 */
const fs = require("fs");
const path = require("path");
const sharp = require("sharp");

const COINS_DIR = path.join(__dirname, "..", "public", "image", "coins");
// Порог: пиксель считаем «белым фоном», если все каналы >= этого значения. 235 = более агрессивная обрезка.
const WHITE_THRESHOLD = 235;

/** Находит bbox контента (пиксели не белые) и возвращает { left, top, width, height } или null. */
async function getContentBbox(inputBuffer) {
  const { data, info } = await sharp(inputBuffer)
    .flatten({ background: { r: 255, g: 255, b: 255 } })
    .raw()
    .toBuffer({ resolveWithObject: true });
  const w = info.width;
  const h = info.height;
  const ch = info.channels;
  let minX = w;
  let minY = h;
  let maxX = 0;
  let maxY = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * ch;
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      if (r < WHITE_THRESHOLD || g < WHITE_THRESHOLD || b < WHITE_THRESHOLD) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (minX > maxX) return null;
  const left = Math.max(0, minX);
  const top = Math.max(0, minY);
  const width = Math.min(w - left, maxX - minX + 1);
  const height = Math.min(h - top, maxY - minY + 1);
  if (width <= 0 || height <= 0) return null;
  return { left, top, width, height };
}

async function cropWhiteAndSave(fp) {
  const buf = fs.readFileSync(fp);
  const bbox = await getContentBbox(buf);
  if (!bbox) return buf;
  return await sharp(buf)
    .flatten({ background: { r: 255, g: 255, b: 255 } })
    .extract(bbox)
    .webp({ quality: 92 })
    .toBuffer();
}

async function run() {
  if (!fs.existsSync(COINS_DIR)) {
    console.log("Папка не найдена:", COINS_DIR);
    process.exit(1);
  }
  const files = fs.readdirSync(COINS_DIR).filter((f) => f.endsWith(".webp"));
  console.log("Найдено файлов:", files.length);
  let done = 0;
  let err = 0;
  for (const name of files) {
    const fp = path.join(COINS_DIR, name);
    try {
      const out = await cropWhiteAndSave(fp);
      fs.writeFileSync(fp, out);
      done++;
      if (done % 20 === 0) console.log("  обработано", done);
    } catch (e) {
      console.log("  —", name, e.message);
      err++;
    }
  }
  console.log("Готово. Обрезано по белому:", done, "Ошибок:", err);
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
