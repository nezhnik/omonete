/**
 * Проверка: сколько записей червонцев в БД и есть ли у них картинки.
 * Запуск: node scripts/check-chervonets-in-db.js
 */
require("dotenv").config({ path: ".env" });
const mysql = require("mysql2/promise");
const path = require("path");

async function run() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL не задан");
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

  const [rows] = await conn.execute(
    `SELECT id, catalog_number, release_date, title, mint_short,
     image_obverse IS NOT NULL AND TRIM(COALESCE(image_obverse,'')) != '' AS has_obv,
     image_reverse IS NOT NULL AND TRIM(COALESCE(image_reverse,'')) != '' AS has_rev
     FROM coins
     WHERE catalog_number LIKE '3213-%' OR title LIKE '%Червонец%'
     ORDER BY catalog_number`
  );

  console.log("Записей червонцев в БД:", rows.length);
  rows.forEach((r) => {
    const ok = r.has_obv && r.has_rev ? "✓ в экспорт" : "✗ нет обеих картинок";
    const year = r.release_date ? String(r.release_date).slice(0, 4) : "";
    console.log("  ", r.id, r.catalog_number, year, r.title?.slice(0, 40), r.mint_short, "|", ok);
  });

  const withImage = rows.filter((r) => r.has_obv && r.has_rev).length;
  console.log("\nС картинками (попадут в экспорт):", withImage);

  await conn.end();
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
