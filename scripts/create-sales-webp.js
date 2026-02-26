/**
 * Создаёт public/image/sales.webp для блока «Где можно приобрести или заказать».
 * Запуск: node scripts/create-sales-webp.js
 */
const sharp = require("sharp");
const path = require("path");
const fs = require("fs");

const outPath = path.join(__dirname, "..", "public", "image", "sales.webp");
const dir = path.dirname(outPath);
if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

const svg = Buffer.from(
  `<svg xmlns="http://www.w3.org/2000/svg" width="176" height="176" viewBox="0 0 176 176">
  <rect width="176" height="176" fill="#F1F1F2" rx="14"/>
  <text x="88" y="92" text-anchor="middle" font-family="system-ui,sans-serif" font-size="16" fill="#666666">Реклама</text>
</svg>`
);

sharp(svg)
  .webp({ quality: 90 })
  .toFile(outPath)
  .then(() => console.log("✓", outPath))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
