/**
 * Удаляет дубликат сколопендры: оставляем AU-PERTH-2026-26Y15AAA (новый скрипт, есть коробка),
 * удаляем AU-PERTH-CENTIPEDE-2026 (старый JSON). Запуск: node scripts/remove-perth-duplicate.js
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
  const [rows] = await conn.execute(
    "SELECT id, catalog_number, title FROM coins WHERE catalog_number IN ('AU-PERTH-CENTIPEDE-2026', 'AU-PERTH-2026-26Y15AAA')"
  );
  const toRemove = rows.find((r) => r.catalog_number === "AU-PERTH-CENTIPEDE-2026");
  const toKeep = rows.find((r) => r.catalog_number === "AU-PERTH-2026-26Y15AAA");
  if (!toRemove) {
    console.log("Дубликат AU-PERTH-CENTIPEDE-2026 не найден в БД.");
    await conn.end();
    return;
  }
  await conn.execute("DELETE FROM coins WHERE id = ?", [toRemove.id]);
  console.log("Удалён дубликат: id=" + toRemove.id, toRemove.catalog_number, toRemove.title);
  if (toKeep) console.log("Оставлена монета:", toKeep.catalog_number);
  await conn.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
