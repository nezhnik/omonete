/**
 * Устанавливает названия червонцев в формате «Один червонец Сеятель год» (для 1977 — с суффиксом ММД/ЛМД).
 * Запуск: node scripts/set-chervonets-titles.js
 */
require("dotenv").config({ path: ".env" });
const mysql = require("mysql2/promise");
const path = require("path");

const TITLES = {
  "3213-0001": "Один червонец Сеятель 1923",
  "3213-0002": "Один червонец Сеятель 1975",
  "3213-0003": "Один червонец Сеятель 1976",
  "3213-0004": "Один червонец Сеятель 1977 (ММД)",
  "3213-0004-ЛМД": "Один червонец Сеятель 1977 (ЛМД)",
  "3213-0005": "Один червонец Сеятель 1978",
  "3213-0006": "Один червонец Сеятель 1979",
  "3213-0007": "Один червонец Сеятель 1980",
  "3213-0009": "Один червонец Сеятель 1981",
  "3213-0010": "Один червонец Сеятель 1982",
};

async function run() {
  require("dotenv").config({ path: path.join(__dirname, "..", ".env") });
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

  for (const [catalog_number, title] of Object.entries(TITLES)) {
    const [res] = await conn.execute(
      `UPDATE coins SET title = ? WHERE catalog_number = ?`,
      [title, catalog_number]
    );
    if (res.affectedRows > 0) {
      console.log("✓", catalog_number, "→", title);
    }
  }

  await conn.end();
  console.log("Готово. Дальше: npm run data:export (или npm run build).");
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
