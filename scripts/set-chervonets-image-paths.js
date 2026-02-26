/**
 * Проставляет в БД пути к уже существующим webp червонцев (3213-0001 … 3213-0010, 3213-0004-ЛМД).
 * Запускать после add-chervonets-by-year.js и update-chervonets-series.js.
 * Запуск: node scripts/set-chervonets-image-paths.js
 */
require("dotenv").config({ path: ".env" });
const mysql = require("mysql2/promise");
const path = require("path");

const CATALOGS = [
  "3213-0001",
  "3213-0002",
  "3213-0003",
  "3213-0004",
  "3213-0004-ЛМД",
  "3213-0005",
  "3213-0006",
  "3213-0007",
  "3213-0009",
  "3213-0010",
];

async function run() {
  const envPath = path.join(__dirname, "..", ".env");
  require("dotenv").config({ path: envPath });
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

  for (const cat of CATALOGS) {
    const base = cat === "3213-0004-ЛМД" ? "3213-0004" : cat;
    const obverse = `/image/coins/${base}.webp`;
    const reverse = `/image/coins/${base}r.webp`;
    const [res] = await conn.execute(
      `UPDATE coins SET image_obverse = ?, image_reverse = ? WHERE catalog_number = ?`,
      [obverse, reverse, cat]
    );
    if (res.affectedRows > 0) {
      console.log("✓", cat);
    }
  }

  await conn.end();
  console.log("Готово. Дальше: npm run data:export && npm run build");
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
