/**
 * Добавляет столбцы image_blister_reverse, image_blister_obverse в coins (после image_reverse).
 * Идемпотентно: если колонки уже есть — выход без ошибки.
 * Запуск из корня omonete-app: node scripts/run-add-coins-blister-images.js
 */
require("dotenv").config({ path: ".env" });
const mysql = require("mysql2/promise");

function parseDatabaseUrl(url) {
  const m = url.match(/mysql:\/\/([^:]+):([^@]+)@([^:]+):(\d+)\/(.+)/);
  if (!m) return null;
  const [, user, password, host, port, database] = m;
  return { host, port: parseInt(port, 10), user, password, database };
}

async function run() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL не задан в .env");
    process.exit(1);
  }
  const cfg = parseDatabaseUrl(url);
  if (!cfg) {
    console.error("Неверный формат DATABASE_URL");
    process.exit(1);
  }

  const conn = await mysql.createConnection({
    host: cfg.host,
    port: cfg.port,
    user: cfg.user,
    password: cfg.password,
    database: cfg.database,
  });

  const [cols] = await conn.execute(
    `SELECT COLUMN_NAME FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'coins'
       AND COLUMN_NAME IN ('image_blister_reverse','image_blister_obverse')`,
    [cfg.database]
  );
  const existing = new Set(cols.map((r) => r.COLUMN_NAME));

  if (existing.has("image_blister_reverse") && existing.has("image_blister_obverse")) {
    console.log("✓ Столбцы image_blister_reverse и image_blister_obverse уже есть.");
    await conn.end();
    return;
  }

  if (!existing.has("image_blister_reverse")) {
    await conn.execute(`
      ALTER TABLE coins
        ADD COLUMN image_blister_reverse VARCHAR(1024) NULL DEFAULT NULL COMMENT 'Реверс в блистере' AFTER image_reverse
    `);
    console.log("✓ Добавлен image_blister_reverse");
  }
  if (!existing.has("image_blister_obverse")) {
    await conn.execute(`
      ALTER TABLE coins
        ADD COLUMN image_blister_obverse VARCHAR(1024) NULL DEFAULT NULL COMMENT 'Аверс в блистере' AFTER image_blister_reverse
    `);
    console.log("✓ Добавлен image_blister_obverse");
  }

  await conn.end();
  console.log("✓ Миграция блистеров завершена.");
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
