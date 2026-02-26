/**
 * Конвертирует улучшенные PNG в WebP и кладёт в public/image/coins и out/image/coins (база 5216-0060).
 * Положите PNG в scripts/ как 5216-0060-obverse.png и 5216-0060-reverse.png, затем: node scripts/convert-improved-to-webp.js
 */
const sharp = require("sharp");
const path = require("path");
const fs = require("fs");

const BASE = "5216-0060";
const DIR = path.join(__dirname, "..");
const COINS_PUBLIC = path.join(DIR, "public", "image", "coins");
const COINS_OUT = path.join(DIR, "out", "image", "coins");

// Ищем PNG в scripts/ (obverse = без r, reverse = с орлом)
const obversePng = path.join(__dirname, `${BASE}-obverse.png`);
const reversePng = path.join(__dirname, `${BASE}-reverse.png`);
const obversePngAlt = path.join(__dirname, "5216-0060-2-094a54eb-6d53-4046-9006-3bbc6596abaf.png");
const reversePngAlt = path.join(__dirname, "5216-0060r-2-5ae190a3-4fe2-491f-b26a-e2f2d0b1a475.png");

const obverseSrc = fs.existsSync(obversePng) ? obversePng : obversePngAlt;
const reverseSrc = fs.existsSync(reversePng) ? reversePng : reversePngAlt;

if (!fs.existsSync(obverseSrc) || !fs.existsSync(reverseSrc)) {
  console.error("Положите в scripts/ два PNG: 5216-0060-obverse.png и 5216-0060-reverse.png (или с именами 5216-0060-2-....png и 5216-0060r-2-....png)");
  process.exit(1);
}

async function run() {
  if (!fs.existsSync(COINS_PUBLIC)) fs.mkdirSync(COINS_PUBLIC, { recursive: true });
  if (!fs.existsSync(COINS_OUT)) fs.mkdirSync(COINS_OUT, { recursive: true });

  const obverseWebp = path.join(COINS_PUBLIC, `${BASE}.webp`);
  const reverseWebp = path.join(COINS_PUBLIC, `${BASE}r.webp`);
  await sharp(obverseSrc).webp({ quality: 92 }).toFile(obverseWebp);
  console.log("✓", obverseWebp);
  await sharp(reverseSrc).webp({ quality: 92 }).toFile(reverseWebp);
  console.log("✓", reverseWebp);

  const outObverse = path.join(COINS_OUT, `${BASE}.webp`);
  const outReverse = path.join(COINS_OUT, `${BASE}r.webp`);
  fs.copyFileSync(obverseWebp, outObverse);
  fs.copyFileSync(reverseWebp, outReverse);
  console.log("✓", outObverse);
  console.log("✓", outReverse);
  console.log("Готово. Обновлены public и out для базы", BASE);
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
