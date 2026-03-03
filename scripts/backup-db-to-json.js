/**
 * Резервная копия таблицы coins в JSON.
 * Запуск: node scripts/backup-db-to-json.js
 * Результат: backup/db-coins-YYYYMMDD-HHmmss.json
 */
require("dotenv").config({ path: ".env" });
const mysql = require("mysql2/promise");
const fs = require("fs");
const path = require("path");

const BACKUP_DIR = path.join(__dirname, "..", "backup");

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

  let rows;
  try {
    [rows] = await conn.execute(
      `SELECT * FROM coins ORDER BY id`
    );
  } catch (err) {
    console.error("Ошибка чтения coins:", err.message);
    process.exit(1);
  } finally {
    await conn.end();
  }

  if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR, { recursive: true });

  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19).replace("T", "_");
  const outPath = path.join(BACKUP_DIR, `db-coins-${stamp}.json`);

  const backup = {
    backupAt: new Date().toISOString(),
    table: "coins",
    count: rows.length,
    rows,
  };

  fs.writeFileSync(outPath, JSON.stringify(backup, null, 2), "utf8");
  console.log("✓ Резервная копия:", outPath);
  console.log("  Монет:", rows.length);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
