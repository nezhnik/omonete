/**
 * Обнуляет пути картинок у всех монет (перед массовой перезагрузкой изображений).
 * Запуск: node scripts/clear-coin-images-db.js
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
  const [r] = await conn.execute(
    "UPDATE coins SET image_obverse = NULL, image_reverse = NULL"
  );
  await conn.end();
  console.log("Обнулено путей картинок у всех монет. Затронуто строк:", r.affectedRows);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
