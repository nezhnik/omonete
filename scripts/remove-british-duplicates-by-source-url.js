/**
 * Удаление дубликатов монет Великобритании: для каждого source_url оставляем запись с min(id), остальные удаляем.
 * Список id берётся из той же логики, что и analyze-british-coins.js.
 * Запуск: node scripts/remove-british-duplicates-by-source-url.js       — сухой прогон
 *         node scripts/remove-british-duplicates-by-source-url.js --do  — выполнить DELETE
 */
require("dotenv").config({ path: ".env" });
const mysql = require("mysql2/promise");

function getConfig() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL не задан");
  const m = url.match(/mysql:\/\/([^:]+):([^@]+)@([^:]+):(\d+)\/(.+)/);
  if (!m) throw new Error("Неверный формат DATABASE_URL");
  const [, user, password, host, port, database] = m;
  return { host, port: parseInt(port, 10), user, password, database };
}

function normUrl(u) {
  if (!u || typeof u !== "string") return null;
  return u.trim().replace(/\/+$/, "") || null;
}

async function main() {
  const doDelete = process.argv.includes("--do");
  if (!doDelete) console.log("Сухой прогон. Для удаления запустите с флагом --do\n");

  const conn = await mysql.createConnection(getConfig());

  const [rows] = await conn.execute(
    `SELECT id, title, source_url
     FROM coins
     WHERE (country LIKE '%Великобритания%' OR country = 'United Kingdom') AND source_url IS NOT NULL AND source_url != ''
     ORDER BY source_url, id`
  );

  const byUrl = new Map();
  for (const r of rows) {
    const url = normUrl(r.source_url);
    if (!url) continue;
    if (!byUrl.has(url)) byUrl.set(url, []);
    byUrl.get(url).push(r);
  }

  const toRemove = [];
  for (const [, arr] of byUrl) {
    if (arr.length <= 1) continue;
    arr.sort((a, b) => a.id - b.id);
    for (let i = 1; i < arr.length; i++) toRemove.push(arr[i]);
  }

  const ids = toRemove.map((r) => r.id).sort((a, b) => a - b);
  console.log("Дубликатов по source_url (Великобритания) к удалению:", ids.length);
  console.log("ID:", ids.join(", "));

  if (ids.length === 0) {
    await conn.end();
    return;
  }

  if (doDelete) {
    const placeholders = ids.map(() => "?").join(",");
    await conn.execute("DELETE FROM coins WHERE id IN (" + placeholders + ")", ids);
    console.log("Удалено записей:", ids.length);
  } else {
    console.log("\nЗапустите с --do для выполнения DELETE.");
  }

  await conn.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
