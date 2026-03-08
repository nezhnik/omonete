/**
 * Удаление дублей Perth в БД: для каждого (catalog_number, title) оставляем одну запись
 * (с source_url и меньшим id), остальные удаляем.
 *
 * Запуск:
 *   node scripts/remove-perth-db-duplicates.js       — показать, что будет удалено
 *   node scripts/remove-perth-db-duplicates.js --do — выполнить DELETE
 */
require("dotenv").config({ path: ".env" });
const mysql = require("mysql2/promise");

function getConfig() {
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
  return { host, port: parseInt(port, 10), user, password, database };
}

function norm(s) {
  return (s || "").trim().toLowerCase();
}

async function main() {
  const doDelete = process.argv.includes("--do");
  const conn = await mysql.createConnection(getConfig());
  const [rows] = await conn.execute(
    `SELECT id, title, catalog_number, source_url FROM coins
     WHERE mint LIKE '%Perth%' OR mint_short LIKE '%Perth%'
     ORDER BY LOWER(TRIM(title)), id`
  );
  const byKey = new Map();
  rows.forEach((r) => {
    const key = norm(r.catalog_number) + "\n" + norm(r.title);
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key).push({ id: r.id, title: r.title, catalog_number: r.catalog_number, source_url: r.source_url || "" });
  });
  const toDelete = [];
  byKey.forEach((arr, key) => {
    if (arr.length < 2) return;
    const withUrl = arr.filter((a) => a.source_url && a.source_url.trim());
    const keep = withUrl.length ? withUrl.sort((a, b) => a.id - b.id)[0] : arr.sort((a, b) => a.id - b.id)[0];
    arr.forEach((a) => {
      if (a.id !== keep.id) toDelete.push(a);
    });
  });
  if (toDelete.length === 0) {
    console.log("Дублей в БД (Perth по catalog_number+title) не найдено.");
    await conn.end();
    return;
  }
  console.log("К удалению (дубли Perth, оставляем запись с source_url или с меньшим id):", toDelete.length);
  toDelete.slice(0, 25).forEach((r) => console.log("  id=" + r.id, (r.title || "").substring(0, 50)));
  if (toDelete.length > 25) console.log("  ... и ещё", toDelete.length - 25);
  if (!doDelete) {
    console.log("\nДля выполнения: node scripts/remove-perth-db-duplicates.js --do");
    await conn.end();
    return;
  }
  const ids = toDelete.map((r) => r.id);
  const placeholders = ids.map(() => "?").join(",");
  const [result] = await conn.execute("DELETE FROM coins WHERE id IN (" + placeholders + ")", ids);
  console.log("\nУдалено записей:", result.affectedRows);
  await conn.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
