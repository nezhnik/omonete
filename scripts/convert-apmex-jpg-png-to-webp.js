/**
 * Конвертирует JPG/PNG в папке apmex-kookaburra в WebP.
 * Извлекает год и вес из имени файла для именования.
 *
 * Запуск: node scripts/convert-apmex-jpg-png-to-webp.js
 */

/* eslint-disable no-console */

const fs = require("fs");
const path = require("path");
const sharp = require("sharp");

const OUT_DIR = path.join(__dirname, "..", "public", "image", "coins", "foreign");
const MAX_SIDE = 1200;

function parseFromFilename(name) {
  const base = name.replace(/\.(jpg|jpeg|png)$/i, "");
  const yearM = base.match(/(\d{4})/);
  const year = yearM ? parseInt(yearM[1], 10) : null;

  let weight = "1oz";
  if (/10[- ]?oz|10oz/i.test(base)) weight = "10oz";
  else if (/5[- ]?oz|5oz/i.test(base)) weight = "5oz";
  else if (/2[- ]?oz|2oz|silver[- ]?2[- ]?super|1[- ]?oz[- ]?silver[- ]?2/i.test(base)) weight = "2oz";
  else if (/1[- ]?kg|1kg|1[- ]?kilo/i.test(base)) weight = "1kg";
  else if (/1[- ]?10[- ]?oz|1\/10|110-oz/i.test(base)) weight = "1/10oz";
  else if (/1[- ]?oz|1oz/i.test(base)) weight = "1oz";

  let side = "obv";
  if (/[-_]rev\.|_Rev\.|[-_]Rev\./i.test(name)) side = "rev";
  else if (/[-_]obv\.|_Obv\.|[-_]Obv\./i.test(name)) side = "obv";
  else if (/[-_]slab\.|_Slab\./i.test(name)) side = "slab";
  else if (/[-_]box\.|_box\./i.test(name)) side = "box";
  else if (/[-_]cert\.|_cert\./i.test(name)) side = "cert";
  else if (/-rev\.(jpg|jpeg|png)$/i.test(name) || name.toLowerCase().endsWith("rev.jpg") || name.toLowerCase().endsWith("rev.png")) side = "rev";
  else if (/-obv\.(jpg|jpeg|png)$/i.test(name) || name.toLowerCase().endsWith("obv.jpg") || name.toLowerCase().endsWith("obv.png")) side = "obv";

  return { year, weight, side, base };
}

async function main() {
  if (!fs.existsSync(OUT_DIR)) {
    console.error("Папка не найдена:", OUT_DIR);
    process.exit(1);
  }

  const files = fs.readdirSync(OUT_DIR).filter((f) => /\.(jpg|jpeg|png)$/i.test(f));
  if (files.length === 0) {
    console.log("JPG/PNG не найдены в", OUT_DIR);
    return;
  }

  console.log("Найдено JPG/PNG:", files.length);
  let converted = 0;

  for (const f of files) {
    const srcPath = path.join(OUT_DIR, f);
    const { year, weight, side, base } = parseFromFilename(f);

    let webpName;
    if (year && (side === "obv" || side === "rev")) {
      const w = String(weight).replace(/[^a-z0-9.\/]/g, "").replace("1/10oz", "1-10oz");
      webpName = `kookaburra-${w}-${year}-${side}.webp`;
    } else if (year && (side === "box" || side === "cert" || side === "slab")) {
      const w = String(weight).replace(/[^a-z0-9.\/]/g, "").replace("1/10oz", "1-10oz");
      webpName = `kookaburra-${w}-${year}-${side}.webp`;
    } else {
      webpName = base.replace(/[^a-z0-9-]/gi, "-").replace(/-+/g, "-") + ".webp";
    }

    const destPath = path.join(OUT_DIR, webpName);
    if (fs.existsSync(destPath)) {
      console.log("  skip (уже есть):", f, "→", webpName);
      fs.unlinkSync(srcPath);
      converted++;
      continue;
    }

    try {
      await sharp(srcPath)
        .resize(MAX_SIDE, MAX_SIDE, { fit: "inside", withoutEnlargement: true })
        .webp({ quality: 85, effort: 6 })
        .toFile(destPath);
      fs.unlinkSync(srcPath);
      console.log("  ✓", f, "→", webpName);
      converted++;
    } catch (e) {
      console.error("  ✗", f, e.message);
    }
  }

  console.log("\nГотово. Конвертировано:", converted);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
