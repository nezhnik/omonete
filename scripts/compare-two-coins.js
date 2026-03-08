/**
 * Сравнение двух монет по id. Запуск: node scripts/compare-two-coins.js 5087 5088
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

async function main() {
  const id1 = parseInt(process.argv[2], 10);
  const id2 = parseInt(process.argv[3], 10);
  if (!id1 || !id2) {
    console.log("Использование: node scripts/compare-two-coins.js <id1> <id2>");
    process.exit(1);
  }

  const conn = await mysql.createConnection(getConfig());
  const [rows] = await conn.execute(
    "SELECT * FROM coins WHERE id IN (?, ?) ORDER BY id",
    [id1, id2]
  );
  await conn.end();

  if (rows.length !== 2) {
    console.log("Найдено записей:", rows.length, rows.map((r) => r.id));
    process.exit(1);
  }

  const [a, b] = rows;
  const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])].filter((k) => k !== "created_at" && k !== "updated_at").sort();

  console.log("--- id", a.id, "---\n", JSON.stringify(a, null, 2));
  console.log("\n--- id", b.id, "---\n", JSON.stringify(b, null, 2));
  console.log("\n--- Отличия по полям ---");
  const diff = [];
  keys.forEach((k) => {
    const v1 = a[k];
    const v2 = b[k];
    const s1 = v1 == null ? "" : String(v1);
    const s2 = v2 == null ? "" : String(v2);
    if (s1 !== s2) diff.push({ key: k, [a.id]: s1.substring(0, 80), [b.id]: s2.substring(0, 80) });
  });
  if (diff.length === 0) console.log("Нет отличий (кроме id).");
  else diff.forEach((d) => console.log(d.key + ":", d));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
