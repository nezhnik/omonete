/**
 * Очищает поле mint (монетный двор) в БД от HTML-тегов, сущностей и лишнего текста.
 * Убирает: <br>, &nbsp;, «Оформление гурта: …», «— 20 000 шт» и т.п.
 * Запуск: node scripts/clean-mint-in-db.js
 */
require("dotenv").config({ path: ".env" });
const mysql = require("mysql2/promise");

function cleanMint(s) {
  if (s == null || typeof s !== "string") return "";
  return s
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<nobr>/gi, "")
    .replace(/<\/nobr>/gi, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&mdash;/gi, "—")
    .replace(/<\/?p[^>]*>/gi, " ")
    .replace(/<\/?div[^>]*>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s*Оформление[^.]*$/i, "")
    .replace(/\s*—\s*\d[\d\s]*\s*шт\.?\s*$/i, "")
    .replace(/^\s*:\s*/, "")
    .replace(/\s+/g, " ")
    .trim();
}

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

  const [rows] = await conn.execute(
    `SELECT id, catalog_number, mint FROM coins WHERE mint IS NOT NULL AND TRIM(mint) != ''`
  );
  let updated = 0;
  for (const row of rows) {
    const cleaned = cleanMint(row.mint);
    if (cleaned !== row.mint) {
      await conn.execute("UPDATE coins SET mint = ? WHERE id = ?", [cleaned, row.id]);
      updated++;
      console.log("  ", row.catalog_number, "| id", row.id, ":", row.mint?.slice(0, 50), "→", cleaned?.slice(0, 50));
    }
  }
  console.log("Готово. Обновлено записей:", updated, "из", rows.length);
  await conn.end();
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
