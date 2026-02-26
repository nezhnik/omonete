/**
 * Добавляет столбцы image_obverse, image_reverse, image_box, image_certificate в coins.
 * В них храним путь на нашем сайте (напр. /image/coins/5109-0128-obverse.webp) или полный URL.
 * Запуск: из корня omonete-app — node scripts/run-add-coin-image-columns.js
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

  const [cols] = await conn.execute(
    `SELECT COLUMN_NAME FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'coins' AND COLUMN_NAME IN ('image_obverse','image_reverse','image_box','image_certificate')`,
    [database]
  );
  const existing = new Set(cols.map((r) => r.COLUMN_NAME));

  if (existing.size === 4) {
    console.log("✓ Столбцы image_obverse, image_reverse, image_box, image_certificate уже есть.");
    await conn.end();
    return;
  }

  if (!existing.has("image_obverse")) {
    await conn.execute(`
      ALTER TABLE coins ADD COLUMN image_obverse VARCHAR(512) DEFAULT NULL COMMENT 'Аверс: путь или URL' AFTER catalog_number
    `);
    console.log("✓ Добавлен image_obverse");
  }
  if (!existing.has("image_reverse")) {
    await conn.execute(`
      ALTER TABLE coins ADD COLUMN image_reverse VARCHAR(512) DEFAULT NULL COMMENT 'Реверс: путь или URL' AFTER image_obverse
    `);
    console.log("✓ Добавлен image_reverse");
  }
  if (!existing.has("image_box")) {
    await conn.execute(`
      ALTER TABLE coins ADD COLUMN image_box VARCHAR(512) DEFAULT NULL COMMENT 'Коробка' AFTER image_reverse
    `);
    console.log("✓ Добавлен image_box");
  }
  if (!existing.has("image_certificate")) {
    await conn.execute(`
      ALTER TABLE coins ADD COLUMN image_certificate VARCHAR(512) DEFAULT NULL COMMENT 'Сертификат' AFTER image_box
    `);
    console.log("✓ Добавлен image_certificate");
  }

  await conn.end();
  console.log("✓ Миграция завершена.");
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
