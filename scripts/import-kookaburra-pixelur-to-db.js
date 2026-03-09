/**
 * Импорт Australian Kookaburra из data/kookaburra-pixelur.json в таблицу coins.
 * Данные в JSON заполняются вручную из картинок Pixelur (https://www.pixelur.com/Kookaburra.html) или из OCR.
 * По catalog_number дубликаты не создаём.
 *
 * Запуск: node scripts/import-kookaburra-pixelur-to-db.js
 */
require("dotenv").config({ path: ".env" });
const mysql = require("mysql2/promise");
const fs = require("fs");
const path = require("path");

const JSON_PATH = path.join(__dirname, "..", "data", "kookaburra-pixelur.json");

function getConfig() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL не задан в .env");
    process.exit(1);
  }
  const m = url.match(/mysql:\/\/([^:]+):([^@]+)@([^:]+):(\d+)\/(.+)/);
  if (!m) {
    console.error("Неверный формат DATABASE_URL");
    process.exit(1);
  }
  const [, user, password, host, port, database] = m;
  return { host, port: parseInt(port, 10), user, password, database };
}

async function main() {
  if (!fs.existsSync(JSON_PATH)) {
    console.error("Файл не найден:", JSON_PATH);
    console.error("Создайте data/kookaburra-pixelur.json по образцу из docs/KOOKABURRA_PIXELUR.md");
    process.exit(1);
  }

  const data = JSON.parse(fs.readFileSync(JSON_PATH, "utf8"));
  const coins = data.coins;
  if (!Array.isArray(coins) || coins.length === 0) {
    console.error("В JSON нет массива coins или он пуст");
    process.exit(1);
  }

  const conn = await mysql.createConnection(getConfig());

  let hasTitleEn = false;
  try {
    const [cols] = await conn.execute(
      "SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'coins' AND COLUMN_NAME = 'title_en'"
    );
    hasTitleEn = cols.length > 0;
  } catch {
    // ignore
  }

  const colsBase = [
    "title", "title_en", "series", "country", "face_value", "mint", "mint_short",
    "metal", "metal_fineness", "mintage", "mintage_display", "weight_g", "weight_oz",
    "release_date", "catalog_number", "catalog_suffix", "quality",
    "diameter_mm", "thickness_mm", "image_obverse", "image_reverse"
  ];
  const cols = hasTitleEn ? colsBase : colsBase.filter((k) => k !== "title_en");

  let inserted = 0;
  let skipped = 0;

  for (const c of coins) {
    const catalogNumber = (c.catalog_number || c.catalogNumber || "").trim();
    if (!catalogNumber) {
      console.warn("  Пропуск: нет catalog_number —", c.title || c.title_en || "?");
      continue;
    }

    const [existing] = await conn.execute(
      "SELECT id FROM coins WHERE catalog_number = ? LIMIT 1",
      [catalogNumber]
    );
    if (existing.length > 0) {
      skipped++;
      continue;
    }

    const rawMintage = c.mintage != null ? parseInt(String(c.mintage).replace(/\s/g, ""), 10) : null;
    const mintage = rawMintage != null ? Math.round(rawMintage / 1000) * 1000 : null;
    const releaseDate = c.release_date && String(c.release_date).trim();
    const releaseDateVal = /^\d{4}-\d{2}-\d{2}$/.test(releaseDate) ? releaseDate : (/^\d{4}$/.test(releaseDate) ? releaseDate + "-01-01" : null);

    const values = [
      c.title || c.title_en || "Australian Kookaburra",
      ...(hasTitleEn ? [c.title_en || c.title || null] : []),
      c.series || "Australian Kookaburra",
      c.country || "Австралия",
      c.face_value || c.faceValue || "1 доллар",
      c.mint || "The Perth Mint",
      c.mint_short || c.mintShort || "Perth Mint",
      c.metal || "Серебро",
      c.metal_fineness || c.metalFineness || "999/1000",
      mintage,
      c.mintage_display != null ? c.mintage_display : null,
      c.weight_g || c.weightG || "31,1",
      c.weight_oz || c.weightOz || "1 унция",
      releaseDateVal,
      catalogNumber,
      (c.catalog_suffix || "").trim() || null,
      c.quality || "АЦ",
      c.diameter_mm || c.diameterMm || null,
      c.thickness_mm || c.thicknessMm || null,
      c.image_obverse || null,
      c.image_reverse || null
    ];

    const placeholders = cols.map(() => "?").join(", ");
    await conn.execute(
      `INSERT INTO coins (${cols.join(", ")}) VALUES (${placeholders})`,
      values
    );
    inserted++;
  }

  await conn.end();
  console.log("✓ Kookaburra (Pixelur): добавлено", inserted, ", пропущено (уже есть)", skipped);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
