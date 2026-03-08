/**
 * Удаляет монету id=4198 (Corporate Personalised Medallions) из БД и все связанные файлы.
 * Запуск: node scripts/delete-coin-4198.js
 */
require("dotenv").config({ path: ".env" });
const mysql = require("mysql2/promise");
const fs = require("fs");
const path = require("path");

const COIN_ID = 4198;
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

  const [rows] = await conn.execute("SELECT id, title, catalog_number FROM coins WHERE id = ?", [COIN_ID]);
  if (rows.length === 0) {
    console.log("Монета id=" + COIN_ID + " не найдена в БД.");
    await conn.end();
    return;
  }
  console.log("Удаляю из БД:", rows[0].title, "|", rows[0].catalog_number);

  await conn.execute("DELETE FROM coins WHERE id = ?", [COIN_ID]);
  console.log("✓ Запись удалена из БД.");
  await conn.end();

  const toRemove = [
    path.join(BASE, "public", "data", "coins", COIN_ID + ".json"),
    path.join(BASE, "data", "perth-mint-corporate-personalised-medallions-2026.json"),
    path.join(BASE, "public", "image", "coins", "foreign", "corporate-personalised-medallions-2026-obv.webp"),
    path.join(BASE, "public", "image", "coins", "foreign", "corporate-personalised-medallions-2026-rev.webp"),
    path.join(BASE, "public", "image", "coins", "foreign", "corporate-personalised-medallions-2026-cert.webp"),
  ];
  for (const f of toRemove) {
    if (fs.existsSync(f)) {
      fs.unlinkSync(f);
      console.log("✓ Удалён:", path.relative(BASE, f));
    }
  }
  console.log("Готово. Запусти npm run data:export && npm run build, чтобы обновить список и билд.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
