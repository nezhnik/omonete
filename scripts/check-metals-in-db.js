/**
 * Проверка: какие металлы есть в БД и остались ли недрагоценные.
 * Запуск: node scripts/check-metals-in-db.js
 */
require("dotenv").config({ path: ".env" });
const mysql = require("mysql2/promise");

const PRECIOUS_PATTERNS = ["золот", "серебр", "платин", "палладий"];

function isPrecious(metal) {
  if (!metal || !metal.trim()) return false;
  const m = metal.toLowerCase();
  return PRECIOUS_PATTERNS.some((p) => m.includes(p));
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
    `SELECT metal, COUNT(*) as cnt FROM coins GROUP BY metal ORDER BY cnt DESC`
  );
  await conn.end();

  console.log("Все металлы в БД (металл | кол-во монет):\n");
  const nonPrecious = [];
  for (const r of rows) {
    const metal = (r.metal || "(пусто)").trim();
    console.log(" ", metal, "|", r.cnt);
    if (metal !== "(пусто)" && !isPrecious(metal)) {
      nonPrecious.push({ metal, cnt: r.cnt });
    }
  }

  if (nonPrecious.length === 0) {
    console.log("\nНедрагоценных металлов не осталось (только золото/серебро/платина/палладий).");
    return;
  }
  console.log("\n--- Недрагоценные металлы (остались в каталоге): ---");
  nonPrecious.forEach(({ metal, cnt }) => console.log(" ", metal, "|", cnt, "монет"));
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
