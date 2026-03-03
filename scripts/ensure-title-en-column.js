/**
 * Добавляет столбец title_en в таблицу coins, если его ещё нет.
 * Запуск: node scripts/ensure-title-en-column.js
 */
require("dotenv").config({ path: ".env" });
const mysql = require("mysql2/promise");

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
  const conn = await mysql.createConnection(getConfig());
  try {
    const [cols] = await conn.execute(
      "SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'coins' AND COLUMN_NAME = 'title_en'"
    );
    if (cols.length > 0) {
      console.log("✓ title_en уже есть");
      return;
    }
    await conn.execute(
      `ALTER TABLE coins ADD COLUMN title_en VARCHAR(500) DEFAULT NULL COMMENT 'Название на английском (для поиска, SEO)' AFTER title`
    );
    console.log("✓ Добавлена колонка title_en");
  } finally {
    await conn.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
