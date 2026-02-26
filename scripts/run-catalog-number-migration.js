/**
 * 1) Добавляет колонку catalog_number в coins (если её ещё нет).
 * 2) Заливает каталожные номера из xlsx в существующие строки (по title + release_date).
 * Запуск: из корня omonete-app — node scripts/run-catalog-number-migration.js
 */
require("dotenv").config({ path: ".env" });
const mysql = require("mysql2/promise");
const X = require("xlsx");
const path = require("path");
const fs = require("fs");

function parseReleaseYear(val) {
  if (val == null || val === "") return null;
  let d;
  if (typeof val === "number") {
    d = new Date((val - 25569) * 86400 * 1000);
  } else if (typeof val === "string") {
    d = new Date(val);
  } else {
    return null;
  }
  if (isNaN(d.getTime())) return null;
  return d.getFullYear();
}

async function run() {
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

  const conn = await mysql.createConnection({
    host,
    port: parseInt(port, 10),
    user,
    password,
    database,
  });

  // 1) Миграция: добавить колонку catalog_number, если её нет
  const [cols] = await conn.execute(
    `SELECT 1 FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'coins' AND COLUMN_NAME = 'catalog_number'`,
    [database]
  );
  if (cols.length === 0) {
    await conn.execute(`
      ALTER TABLE coins
      ADD COLUMN catalog_number VARCHAR(32) DEFAULT NULL COMMENT 'Каталожный номер (ЦБ)' AFTER image_urls
    `);
    console.log("✓ Колонка catalog_number добавлена.");
  } else {
    console.log("✓ Колонка catalog_number уже есть.");
  }

  // 2) Backfill из xlsx
  const xlsxPath = path.join(__dirname, "..", "RC_F01_01_1992_T06_02_2026.xlsx");
  if (!fs.existsSync(xlsxPath)) {
    console.error("Файл не найден:", xlsxPath);
    await conn.end();
    process.exit(1);
  }

  const wb = X.readFile(xlsxPath);
  const sh = wb.Sheets[wb.SheetNames[0]];
  const rows = X.utils.sheet_to_json(sh, { header: 1, raw: true });
  const dataRows = rows.slice(1).filter((r) => r && r.length && r[2]);

  let updated = 0;
  let skipped = 0;

  for (const row of dataRows) {
    const catalogNum = row[0] != null && String(row[0]).trim() !== "" ? String(row[0]).trim() : null;
    const title = row[2] ? String(row[2]).trim() : null;
    const year = parseReleaseYear(row[1]);
    if (!title || !catalogNum || year == null) {
      skipped++;
      continue;
    }
    const releaseDate = `${year}-01-01`;

    try {
      const [result] = await conn.execute(
        "UPDATE coins SET catalog_number = ? WHERE title = ? AND release_date = ?",
        [catalogNum, title, releaseDate]
      );
      if (result.affectedRows > 0) updated += result.affectedRows;
    } catch (err) {
      console.error("Ошибка обновления:", title?.slice(0, 40), err.message);
    }
  }

  await conn.end();
  console.log("✓ Заливка завершена. Обновлено строк:", updated, "Пропущено:", skipped);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
