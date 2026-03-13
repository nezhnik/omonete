/**
 * Монета 4221 — золото (King George V Sovereign Typeset Collection), в БД ошибочно было серебро.
 * Запуск: node scripts/fix-coin-4221-metal.js
 */
require("dotenv").config({ path: ".env" });
const mysql = require("mysql2/promise");

const COIN_ID = 4221;

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

  const [rows] = await conn.execute("SELECT id, title, metal FROM coins WHERE id = ?", [COIN_ID]);
  if (rows.length === 0) {
    console.log("Монета id=" + COIN_ID + " не найдена.");
    await conn.end();
    return;
  }
  console.log("Было:", rows[0].metal);

  await conn.execute("UPDATE coins SET metal = ? WHERE id = ?", ["Золото", COIN_ID]);
  console.log("✓ metal = Золото для id=" + COIN_ID);
  await conn.end();
  console.log("Дальше: npm run data:export:incremental && npm run build");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
