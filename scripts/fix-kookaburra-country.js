/**
 * Исправление страны для монет Australian Kookaburra: в названии явно «Australian Kookaburra» —
 * страна должна быть Австралия, а не Тувалу.
 *
 * Запуск:
 *   node scripts/fix-kookaburra-country.js       — показать, какие записи будут исправлены
 *   node scripts/fix-kookaburra-country.js --do — выполнить UPDATE
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
  const doUpdate = process.argv.includes("--do");
  const conn = await mysql.createConnection(getConfig());

  const [rows] = await conn.execute(
    `SELECT id, title, country FROM coins
     WHERE country = 'Тувалу'
     AND title LIKE '%Kookaburra%'
     ORDER BY title`
  );

  if (rows.length === 0) {
    console.log("Монет Тувалу с Kookaburra в названии не найдено (уже исправлено или нет таких).");
    await conn.end();
    return;
  }

  console.log("Исправить страну Тувалу → Австралия (в названии Australian Kookaburra):", rows.length);
  rows.forEach((r) => console.log("  /coins/" + r.id + "/ — «" + (r.title || "").substring(0, 70) + "»"));

  if (!doUpdate) {
    console.log("\nДля применения: node scripts/fix-kookaburra-country.js --do");
    await conn.end();
    return;
  }

  const ids = rows.map((r) => r.id);
  const placeholders = ids.map(() => "?").join(",");
  const [result] = await conn.execute(
    "UPDATE coins SET country = 'Австралия' WHERE id IN (" + placeholders + ")",
    ids
  );
  console.log("\nОбновлено записей:", result.affectedRows);
  await conn.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
