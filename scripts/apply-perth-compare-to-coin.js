/**
 * Берёт переименованные картинки из data/perth-compare/<id>/perth/ (как назвал пользователь),
 * конвертирует в webp и записывает в public/image/coins/foreign/, заменяя текущие картинки монеты.
 * Запуск: node scripts/apply-perth-compare-to-coin.js <id>
 * Пример: node scripts/apply-perth-compare-to-coin.js 4424
 */
const fs = require("fs");
const path = require("path");
const sharp = require("sharp");

const ROOT = path.join(__dirname, "..");
const FOREIGN_DIR = path.join(ROOT, "public", "image", "coins", "foreign");
const MAX_SIDE = 1200;

const coinId = process.argv[2];
if (!coinId) {
  console.error("Укажите id монеты: node scripts/apply-perth-compare-to-coin.js 4424");
  process.exit(1);
}

const perthDir = path.join(ROOT, "data", "perth-compare", coinId, "perth");
if (!fs.existsSync(perthDir)) {
  console.error("Папка не найдена:", perthDir);
  process.exit(1);
}

const files = fs.readdirSync(perthDir).filter((f) => /\.(jpg|jpeg|png|webp)$/i.test(f));

async function main() {
  for (const f of files) {
    const ext = path.extname(f).toLowerCase();
    const base = path.basename(f, ext);
    const src = path.join(perthDir, f);
    const dest = path.join(FOREIGN_DIR, base + ".webp");
    const buf = fs.readFileSync(src);
    await sharp(buf)
      .resize(MAX_SIDE, MAX_SIDE, { fit: "inside", withoutEnlargement: true })
      .webp({ quality: 82, effort: 6, smartSubsample: true })
      .toFile(dest);
    console.log("OK", base + ".webp");
  }
  console.log("Готово: картинки из perth применены в public/image/coins/foreign/ для монеты", coinId);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
