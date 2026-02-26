/**
 * Конвертирует PNG логотипы из public/image/Mints/*.png в .webp (как с монетами).
 * Запуск: node scripts/convert-mints-to-webp.js
 */
const sharp = require("sharp");
const path = require("path");
const fs = require("fs");

const DIR = path.join(__dirname, "..", "public", "image", "Mints");

if (!fs.existsSync(DIR)) {
  fs.mkdirSync(DIR, { recursive: true });
  console.log("Папка создана:", DIR);
  process.exit(0);
}

const files = fs.readdirSync(DIR).filter((f) => f.toLowerCase().endsWith(".png"));
if (files.length === 0) {
  console.log("Нет PNG в", DIR);
  process.exit(0);
}

// Имя файла (без .png) → slug для .webp (совпадает с путями в статьях и списках дворов)
const baseToSlug = {
  perth_mint: "perth-mint",
  polska_mint: "polska-mint",
  royal_canadian_mint: "canadian-mint",
  germania_mint: "germania-mint",
  usmint: "us-mint",
  theroyalmint: "royal-mint",
  austrianmint: "austrian-mint",
  samint: "south-african-mint",
  japanmint: "japan-mint",
  komscomint: "komsco",
  monnaiedeparismint: "monnaie-de-paris",
  casademonedamint: "casa-de-moneda-mexico",
  CBPMCmint: "china-mint",
  FNMT_RCMmint: "fnmt-spain",
  IPZSmint: "ipzs-italy",
  spmcilmint: "india-mint",
  knmmint: "royal-dutch-mint",
  swissmint: "swissmint",
  spmdmint: "spmd",
  mmdmint: "mmd",
  lmdmint: "lmd",
  goznak: "goznak",
};

Promise.all(
  files.map((f) => {
    const base = f.replace(/\.png$/i, "");
    const outBase = baseToSlug[base] ?? base;
    const src = path.join(DIR, f);
    const dest = path.join(DIR, outBase + ".webp");
    return sharp(src)
      .webp({ quality: 90 })
      .toFile(dest)
      .then(() => console.log("✓", path.relative(path.join(__dirname, ".."), dest)));
  })
).catch((e) => {
  console.error(e);
  process.exit(1);
});
