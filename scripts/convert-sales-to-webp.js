/**
 * Конвертирует public/image/sales.png в public/image/sales.webp для блока монетизации.
 * Запуск: node scripts/convert-sales-to-webp.js
 */
const sharp = require("sharp");
const path = require("path");

const dir = path.join(__dirname, "..", "public", "image");
const src = path.join(dir, "sales.png");
const dest = path.join(dir, "sales.webp");

sharp(src)
  .webp({ quality: 90 })
  .toFile(dest)
  .then(() => console.log("✓", dest))
  .catch((e) => {
    console.error(e.message);
    process.exit(1);
  });
