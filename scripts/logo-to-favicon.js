/**
 * Конвертирует public/image/logo.png в public/favicon.ico (на всякий случай для старых браузеров).
 * Логотип приводится к квадрату (вписывается в 32x32), затем в .ico.
 * Запуск: node scripts/logo-to-favicon.js
 */
const path = require("path");
const fs = require("fs");
const sharp = require("sharp");
const pngToIco = require("png-to-ico");

const logoPath = path.join(__dirname, "..", "public", "image", "logo.png");
const icoPath = path.join(__dirname, "..", "public", "favicon.ico");
const squarePath = path.join(__dirname, "..", ".favicon-temp.png");
const size = 32;

if (!fs.existsSync(logoPath)) {
  console.error("Не найден:", logoPath);
  process.exit(1);
}

sharp(logoPath)
  .resize(size, size, { fit: "contain", background: { r: 255, g: 255, b: 255, alpha: 0 } })
  .png()
  .toFile(squarePath)
  .then(() => pngToIco(squarePath))
  .then((icoBuf) => {
    fs.writeFileSync(icoPath, icoBuf);
    fs.unlinkSync(squarePath);
    console.log("✓", icoPath);
  })
  .catch((err) => {
    if (fs.existsSync(squarePath)) fs.unlinkSync(squarePath);
    console.error(err);
    process.exit(1);
  });
