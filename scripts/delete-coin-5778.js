/**
 * Удаляет неличную позицию "Innovative Coins" id=5778 из БД и каталога.
 * Запуск: node scripts/delete-coin-5778.js
 */
require("dotenv").config({ path: ".env" });
const mysql = require("mysql2/promise");
const fs = require("fs");
const path = require("path");

const COIN_ID = 5778;
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
    console.log("Монета id=" + COIN_ID + " не найдена в БД.");
    await conn.end();
    return;
  }
  console.log("Удаляю из БД:", rows[0].title);

  await conn.execute("DELETE FROM coins WHERE id = ?", [COIN_ID]);
  console.log("✓ Запись удалена из БД.");
  await conn.end();

  const jsonPath = path.join(BASE, "public", "data", "coins", COIN_ID + ".json");
  if (fs.existsSync(jsonPath)) {
    fs.unlinkSync(jsonPath);
    console.log("✓ Удалён:", path.relative(BASE, jsonPath));
  }
  console.log("Дальше: npm run data:export:incremental && npm run build");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

