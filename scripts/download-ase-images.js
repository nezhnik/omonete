/**
 * Использует только локальные изображения из public/image/coins/foreign/.
 * Реверсы: American-Eagle-oldr.webp (старый), American-Eagle-newr.webp (новый, с 2021).
 * Аверс: если есть American-Eagle-YYYY.png (год в имени) — конвертируем в .webp и вешаем на монеты этого года;
 *        если аверса по году нет — оставляем только реверс (image_obverse = NULL).
 *
 * Запуск: node scripts/download-ase-images.js
 */
require("dotenv").config({ path: ".env" });
const fs = require("fs");
const path = require("path");
const mysql = require("mysql2/promise");
const sharp = require("sharp");

const FOREIGN_DIR = path.join(__dirname, "..", "public", "image", "coins", "foreign");
const MAX_SIDE = 1200;
const WEBP_QUALITY = 88;

/** Новый дизайн: 2021 и новее. Старый — до 2021. */
function isNewDesign(catalogNumber) {
  const cat = String(catalogNumber || "").toUpperCase();
  if (/US-ASE-202[1-9]/.test(cat) || /US-ASE-20[3-9]\d/.test(cat)) return true;
  return false;
}

/** Год из catalog_number, например US-ASE-2025-BU -> 2025 */
function yearFromCatalogNumber(catalogNumber) {
  const m = String(catalogNumber || "").match(/US-ASE-(\d{4})/i);
  return m ? m[1] : null;
}

async function main() {
  if (!fs.existsSync(FOREIGN_DIR)) {
    fs.mkdirSync(FOREIGN_DIR, { recursive: true });
    console.log("✓ Создана папка:", FOREIGN_DIR);
  }

  let files = fs.readdirSync(FOREIGN_DIR);

  // Реверсы: American-Eagle-oldr, American-Eagle-newr — конвертируем .png в .webp если нужно
  for (const key of ["oldr", "newr"]) {
    const name = "American-Eagle-" + key;
    const pngPath = path.join(FOREIGN_DIR, name + ".png");
    const webpPath = path.join(FOREIGN_DIR, name + ".webp");
    if (fs.existsSync(pngPath) && (!fs.existsSync(webpPath) || fs.statSync(pngPath).mtimeMs > fs.statSync(webpPath).mtimeMs)) {
      await sharp(pngPath)
        .resize(MAX_SIDE, MAX_SIDE, { fit: "inside", withoutEnlargement: true })
        .webp({ quality: WEBP_QUALITY })
        .toFile(webpPath);
      console.log("  ✓ реверс:", name + ".webp (из .png)");
    }
  }
  files = fs.readdirSync(FOREIGN_DIR);
  if (!files.some((f) => f === "American-Eagle-oldr.webp")) console.warn("  ⚠ American-Eagle-oldr.webp не найден");
  if (!files.some((f) => f === "American-Eagle-newr.webp")) console.warn("  ⚠ American-Eagle-newr.webp не найден");

  // Аверсы по годам: American-Eagle-YYYY.png -> конвертируем в American-Eagle-YYYY.webp
  const yearPngRe = /^American-Eagle-(\d{4})\.png$/i;
  const obverseByYear = {};
  for (const f of files) {
    const match = f.match(yearPngRe);
    if (!match) continue;
    const year = match[1];
    const pngPath = path.join(FOREIGN_DIR, f);
    const webpName = `American-Eagle-${year}.webp`;
    const webpPath = path.join(FOREIGN_DIR, webpName);
    try {
      await sharp(pngPath)
        .resize(MAX_SIDE, MAX_SIDE, { fit: "inside", withoutEnlargement: true })
        .webp({ quality: WEBP_QUALITY })
        .toFile(webpPath);
      obverseByYear[year] = "/image/coins/foreign/" + webpName;
      console.log("  ✓ аверс по году:", webpName);
    } catch (e) {
      console.error("  ✗", webpName, e.message);
    }
  }
  // Уже готовые .webp по году (без .png) — тоже используем
  for (const f of files) {
    const match = f.match(/^American-Eagle-(\d{4})\.webp$/i);
    if (!match || obverseByYear[match[1]]) continue;
    obverseByYear[match[1]] = "/image/coins/foreign/" + f;
    console.log("  ✓ аверс по году (готовый):", f);
  }

  const oldrPath = "/image/coins/foreign/American-Eagle-oldr.webp";
  const newrPath = "/image/coins/foreign/American-Eagle-newr.webp";

  const url = process.env.DATABASE_URL;
  if (!url) {
    console.log("\nDATABASE_URL не задан — пропуск обновления БД.");
    return;
  }

  const m = url.match(/mysql:\/\/([^:]+):([^@]+)@([^:]+):(\d+)\/(.+)/);
  if (!m) {
    console.log("Неверный формат DATABASE_URL.");
    return;
  }
  const [, user, password, host, port, database] = m;
  const conn = await mysql.createConnection({
    host,
    port: parseInt(port, 10),
    user,
    password,
    database,
  });

  const [rows] = await conn.execute(
    `SELECT id, catalog_number FROM coins
     WHERE country != 'Россия' AND country IS NOT NULL
     AND catalog_number LIKE 'US-ASE-%'`
  );

  let updated = 0;
  for (const r of rows) {
    const isNew = isNewDesign(r.catalog_number);
    const rev = isNew ? newrPath : oldrPath;
    const year = yearFromCatalogNumber(r.catalog_number);
    const obv = year && obverseByYear[year] ? obverseByYear[year] : null;

    await conn.execute(
      `UPDATE coins SET image_obverse = ?, image_reverse = ? WHERE id = ?`,
      [obv, rev, r.id]
    );
    updated++;
  }

  await conn.end();
  console.log("\n✓ Обновлено монет ASE в БД:", updated);
  console.log("Дальше: npm run build");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
