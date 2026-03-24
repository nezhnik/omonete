/**
 * Дубликат 6359 = 6358 (2025 Germania 1 oz Black Silver BU WMF Edition). Оставляем id 6358.
 * Запуск: node scripts/delete-coin-6359-duplicate.js
 * Затем: node scripts/export-coins-to-json.js
 */
require("dotenv").config({ path: ".env" });
const mysql = require("mysql2/promise");
const fs = require("fs");
const path = require("path");

const COIN_ID = 6359;
const BASE = path.join(__dirname, "..");

async function main() {
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
  const conn = await mysql.createConnection({ host, port: parseInt(port, 10), user, password, database });

  const [rows] = await conn.execute("SELECT id, title FROM coins WHERE id = ?", [COIN_ID]);
  if (rows.length === 0) {
    console.log("Монета id=" + COIN_ID + " не найдена в БД (возможно уже удалена).");
    await conn.end();
    return;
  }
  console.log("Удаляю дубликат из БД:", rows[0].title);

  await conn.execute("DELETE FROM coins WHERE id = ?", [COIN_ID]);
  console.log("✓ Запись id=" + COIN_ID + " удалена из БД.");
  await conn.end();

  const jsonPath = path.join(BASE, "public", "data", "coins", COIN_ID + ".json");
  if (fs.existsSync(jsonPath)) {
    fs.unlinkSync(jsonPath);
    console.log("✓ Удалён:", path.relative(BASE, jsonPath));
  }
  console.log("Дальше: node scripts/export-coins-to-json.js");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
