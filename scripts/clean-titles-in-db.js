/**
 * Очищает названия монет в БД от HTML-тегов и сущностей с сайта ЦБ: <nobr>, &nbsp;.
 * Запуск: node scripts/clean-titles-in-db.js
 */
require("dotenv").config({ path: ".env" });
const mysql = require("mysql2/promise");

function cleanTitle(s) {
  if (s == null || typeof s !== "string") return "";
  return s
    .replace(/<nobr>/gi, "")
    .replace(/<\/nobr>/gi, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&mdash;/gi, "—")
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

  const [rows] = await conn.execute("SELECT id, title FROM coins");
  let updated = 0;
  for (const row of rows) {
    const cleaned = cleanTitle(row.title);
    if (cleaned !== row.title) {
      await conn.execute("UPDATE coins SET title = ? WHERE id = ?", [cleaned, row.id]);
      updated++;
      console.log("  id", row.id, ":", row.title?.slice(0, 50), "→", cleaned?.slice(0, 50));
    }
  }
  console.log("Готово. Обновлено записей:", updated, "из", rows.length);
  await conn.end();
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
