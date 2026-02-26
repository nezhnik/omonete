/**
 * 1) Добавляет колонку catalog_suffix в coins (если её ещё нет).
 * 2) Заполняет catalog_suffix из catalog_number: 5111-0178-26 → "26", 5111-0178-10 → "10".
 *
 * Запуск: node scripts/ensure-catalog-suffix-column.js
 */
require("dotenv").config({ path: ".env" });
const mysql = require("mysql2/promise");

function parseSuffixFromCatalogNumber(catNum) {
  if (!catNum || typeof catNum !== "string") return null;
  const m = String(catNum).trim().match(/-(\d{2})$/);
  return m ? m[1] : null; // "26", "10"
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

  // 1) Добавить колонку
  const [cols] = await conn.execute(
    `SELECT 1 FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'coins' AND COLUMN_NAME = 'catalog_suffix'`,
    [database]
  );
  if (cols.length === 0) {
    await conn.execute(
      `ALTER TABLE coins
       ADD COLUMN catalog_suffix VARCHAR(8) DEFAULT NULL COMMENT 'Суффикс каталога: год тиража, напр. 26 для 5111-0178-26' AFTER catalog_number`
    );
    console.log("✓ Колонка catalog_suffix добавлена.");
  } else {
    console.log("✓ Колонка catalog_suffix уже есть.");
  }

  // 2) Бэкфилл из catalog_number
  const [rows] = await conn.execute(
    `SELECT id, catalog_number, catalog_suffix FROM coins WHERE catalog_number IS NOT NULL AND TRIM(catalog_number) != ''`
  );
  let updated = 0;
  for (const r of rows) {
    const suffix = parseSuffixFromCatalogNumber(r.catalog_number);
    if (suffix == null) continue;
    if (r.catalog_suffix === suffix) continue;
    await conn.execute(`UPDATE coins SET catalog_suffix = ? WHERE id = ?`, [suffix, r.id]);
    updated++;
  }
  console.log("✓ Заполнено catalog_suffix из catalog_number:", updated, "записей.");

  await conn.end();
  console.log("Готово.");
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
