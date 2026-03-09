/**
 * Импорт Australian Silver Kangaroo (1 oz bullion) из data/kangaroo-wikipedia.json в таблицу coins.
 * Данные из Wikipedia: https://en.wikipedia.org/wiki/Australian_Silver_Kangaroo_(bullion)
 *
 * Запуск: node scripts/import-kangaroo-wikipedia-to-db.js
 */
require("dotenv").config({ path: ".env" });
const mysql = require("mysql2/promise");
const fs = require("fs");
const path = require("path");

const JSON_PATH = path.join(__dirname, "..", "data", "kangaroo-wikipedia.json");

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
    process.exit(1);
  }

  const data = JSON.parse(fs.readFileSync(JSON_PATH, "utf8"));
  const coins = data.coins;
  const specs = data.specs || {};
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
    "metal", "metal_fineness", "mintage", "weight_g", "weight_oz",
    "release_date", "catalog_number", "quality",
    "diameter_mm", "thickness_mm"
  ];
  const cols = hasTitleEn ? colsBase : colsBase.filter((k) => k !== "title_en");

  let inserted = 0;
  let skipped = 0;

  for (const c of coins) {
    const catalogNumber = (c.catalog_number || "").trim();
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

    const mintage = c.mintage != null ? parseInt(String(c.mintage).replace(/\s/g, ""), 10) : null;
    const releaseDate = c.release_date && String(c.release_date).trim();
    const releaseDateVal = /^\d{4}-\d{2}-\d{2}$/.test(releaseDate) ? releaseDate : (/^\d{4}$/.test(releaseDate) ? releaseDate + "-01-01" : null);

    const values = [
      c.title || c.title_en || "Australian Silver Kangaroo",
      ...(hasTitleEn ? [c.title_en || c.title || null] : []),
      c.series || "Australian Silver Kangaroo",
      c.country || "Австралия",
      c.face_value || specs.face_value || "1 доллар",
      c.mint || "The Perth Mint",
      c.mint_short || "Perth Mint",
      c.metal || specs.metal || "Серебро",
      c.metal_fineness || specs.metal_fineness || "9999/1000",
      mintage,
      c.weight_g || specs.weight_g || "31,1",
      c.weight_oz || specs.weight_oz || "1 унция",
      releaseDateVal,
      catalogNumber,
      c.quality || "АЦ",
      c.diameter_mm || specs.diameter_mm || "40,6",
      c.thickness_mm || specs.thickness_mm || "3,2"
    ];

    const placeholders = cols.map(() => "?").join(", ");
    await conn.execute(
      `INSERT INTO coins (${cols.join(", ")}) VALUES (${placeholders})`,
      values
    );
    inserted++;
  }

  await conn.end();
  console.log("✓ Kangaroo (Wikipedia): добавлено", inserted, ", пропущено (уже есть)", skipped);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
