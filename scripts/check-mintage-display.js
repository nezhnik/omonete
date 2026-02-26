/**
 * Проверка: сколько монет с тиражом «до X» (mintage_display) в БД.
 * Запуск: node scripts/check-mintage-display.js
 */
require("dotenv").config({ path: ".env" });
const mysql = require("mysql2/promise");

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

  const [rows] = await conn.execute(
    `SELECT id, catalog_number, title, mintage, mintage_display FROM coins 
     WHERE mintage_display IS NOT NULL AND TRIM(mintage_display) != '' 
     ORDER BY id ASC`
  );

  console.log("Монет с тиражом «до X» (mintage_display):", rows.length);
  if (rows.length > 0) {
    console.log("");
    rows.forEach((r) => {
      console.log("  id", r.id, "|", r.catalog_number, "|", r.mintage_display, "|", r.title?.slice(0, 50));
    });
  }

  await conn.end();
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
