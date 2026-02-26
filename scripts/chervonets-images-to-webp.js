/**
 * Конвертирует PNG червонцев «Червонец YYYY» / «Червонец YYYYr» в webp с каталожными номерами 3213-XXXX
 * и обновляет в БД image_obverse / image_reverse для соответствующих монет.
 *
 * Год → каталог: 1923→3213-0001, 1975→3213-0002, … 1982→3213-0010
 *
 * Запуск: node scripts/chervonets-images-to-webp.js
 */
require("dotenv").config({ path: ".env" });
const sharp = require("sharp");
const path = require("path");
const fs = require("fs");
const mysql = require("mysql2/promise");

const COINS_DIR = path.join(__dirname, "..", "public", "image", "coins");
const MAX_SIDE = 1200; // как в download-and-optimize-coins.js
const WEBP_QUALITY = 85; // 85 — визуально без потери, размер меньше чем при 90

const YEAR_TO_CATALOG = {
  1923: "3213-0001",
  1975: "3213-0002",
  1976: "3213-0003",
  1977: "3213-0004",
  1978: "3213-0005",
  1979: "3213-0006",
  1980: "3213-0007",
  1981: "3213-0009",
  1982: "3213-0010",
};

async function run() {
  const files = fs.readdirSync(COINS_DIR);
  const pngs = files.filter((f) => /^Червонец \d{4}r?\.png$/i.test(f));
  if (pngs.length === 0) {
    console.log("В папке public/image/coins не найдено файлов вида «Червонец YYYY.png» / «Червонец YYYYr.png»");
    process.exit(0);
  }

  const byYear = {};
  for (const f of pngs) {
    const m = f.match(/^Червонец (\d{4})(r)?\.png$/i);
    if (!m) continue;
    const year = parseInt(m[1], 10);
    const isReverse = !!m[2];
    if (!byYear[year]) byYear[year] = {};
    byYear[year][isReverse ? "r" : "obverse"] = path.join(COINS_DIR, f);
  }

  for (const [yearStr, paths] of Object.entries(byYear)) {
    const year = parseInt(yearStr, 10);
    const cat = YEAR_TO_CATALOG[year];
    if (!cat) continue;
    if (!paths.obverse || !paths.r) {
      console.warn("Пропуск", year, ": нет обеих сторон (аверс и реверс)");
      continue;
    }
    const outBase = path.join(COINS_DIR, cat);
    await sharp(paths.obverse)
      .resize(MAX_SIDE, MAX_SIDE, { fit: "inside", withoutEnlargement: true })
      .webp({ quality: WEBP_QUALITY })
      .toFile(outBase + ".webp");
    console.log("✓", cat + ".webp");
    await sharp(paths.r)
      .resize(MAX_SIDE, MAX_SIDE, { fit: "inside", withoutEnlargement: true })
      .webp({ quality: WEBP_QUALITY })
      .toFile(outBase + "r.webp");
    console.log("✓", cat + "r.webp");
  }

  const url = process.env.DATABASE_URL;
  if (!url) {
    console.log("DATABASE_URL не задан — пропуск обновления БД.");
    return;
  }
  const m = url.match(/mysql:\/\/([^:]+):([^@]+)@([^:]+):(\d+)\/(.+)/);
  if (!m) {
    console.log("Неверный формат DATABASE_URL — пропуск обновления БД.");
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

  for (const [yearStr, paths] of Object.entries(byYear)) {
    const year = parseInt(yearStr, 10);
    const cat = YEAR_TO_CATALOG[year];
    if (!cat || !paths.obverse || !paths.r) continue;
    const obversePath = `/image/coins/${cat}.webp`;
    const reversePath = `/image/coins/${cat}r.webp`;
    const [res] = await conn.execute(
      `UPDATE coins SET image_obverse = ?, image_reverse = ? WHERE catalog_number = ?`,
      [obversePath, reversePath, cat]
    );
    console.log("✓ БД: catalog_number", cat);
    if (cat === "3213-0004") {
      await conn.execute(
        `UPDATE coins SET image_obverse = ?, image_reverse = ? WHERE catalog_number = '3213-0004-ЛМД'`,
        [obversePath, reversePath]
      );
      console.log("✓ БД: catalog_number 3213-0004-ЛМД (те же изображения)");
    }
  }

  await conn.end();
  console.log("Готово. Запустите: npm run build");
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
