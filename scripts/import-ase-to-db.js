/**
 * Импорт American Silver Eagle из data/walking-liberty-ucoin.json в таблицу coins.
 * Картинки НЕ добавляются — только данные. Изображения можно добавить позже в public/image/coins/foreign/.
 *
 * Запуск: node scripts/import-ase-to-db.js
 */
require("dotenv").config({ path: ".env" });
const mysql = require("mysql2/promise");
const fs = require("fs");
const path = require("path");

const JSON_PATH = path.join(__dirname, "..", "data", "walking-liberty-ucoin.json");

/** English → Russian для ASE */
function toRussianTitle(titleEn) {
  if (!titleEn || typeof titleEn !== "string") return "";
  const m = titleEn.match(/American Silver Eagle\s+(\d{4})(?:\s+\(([PSW])\))?/i);
  if (m) {
    const year = m[1];
    const sign = m[2] || "";
    return sign ? `Американский серебряный орёл ${year} (${sign})` : `Американский серебряный орёл ${year}`;
  }
  return titleEn.replace(/American Silver Eagle/i, "Американский серебряный орёл");
}

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
    console.error("Сначала запустите: npm run ucoin:parse-walking-liberty");
    process.exit(1);
  }

  const data = JSON.parse(fs.readFileSync(JSON_PATH, "utf8"));
  const coins = data.coins;
  if (!Array.isArray(coins) || coins.length === 0) {
    console.error("Нет монет в JSON");
    process.exit(1);
  }

  const conn = await mysql.createConnection(getConfig());

  // Проверяем, есть ли title_en
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
    if (!catalogNumber) continue;

    const [existing] = await conn.execute(
      "SELECT id FROM coins WHERE catalog_number = ? LIMIT 1",
      [catalogNumber]
    );
    if (existing.length > 0) {
      skipped++;
      continue;
    }

    const titleEn = c.title_en || c.title || "";
    const titleRu = toRussianTitle(titleEn) || (c.title || "");

    const rawMintage = c.mintage ? parseInt(String(c.mintage).replace(/\s/g, ""), 10) : null;
    const mintage = rawMintage != null ? Math.round(rawMintage / 1000) * 1000 : null;

    const values = [
      titleRu,
      ...(hasTitleEn ? [titleEn || null] : []),
      c.series || "American Eagle",
      c.country || "США",
      c.face_value || c.faceValue || "1 доллар",
      c.mint || "Монетный двор США",
      c.mint_short || c.mintShort || null,
      c.metal || "Серебро",
      c.metal_fineness || c.metalFineness || "999/1000",
      mintage,
      null,
      c.weight_g || c.weightG || "31,1",
      c.weight_oz || c.weightOz || "1 унция",
      c.release_date || null,
      catalogNumber,
      c.catalog_suffix || null,
      c.quality || "АЦ",
      c.diameter_mm || c.diameterMm || "40,6",
      c.thickness_mm || c.thicknessMm || "2,98",
      null,
      null
    ];

    const placeholders = cols.map(() => "?").join(", ");
    await conn.execute(
      `INSERT INTO coins (${cols.join(", ")}) VALUES (${placeholders})`,
      values
    );
    inserted++;
  }

  await conn.end();
  console.log("✓ Импорт ASE: добавлено", inserted, ", пропущено (уже есть)", skipped);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
