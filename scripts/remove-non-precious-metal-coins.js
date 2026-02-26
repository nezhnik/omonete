/**
 * Удаляет из БД монеты из недрагоценных металлов: никель, его сплавы (мельхиор, нейзильбер и т.п.), титан, латунь.
 * Запуск: node scripts/remove-non-precious-metal-coins.js       — только показать, что будет удалено
 *         node scripts/remove-non-precious-metal-coins.js --apply — выполнить удаление
 */
require("dotenv").config({ path: ".env" });
const mysql = require("mysql2/promise");

const DRY_RUN = !process.argv.includes("--apply");

const METAL_PATTERNS = [
  "никель",
  "мельхиор",
  "титан",
  "нейзильбер",
  "медно-никел",
  "никелев",
  "латунь",
  "латун",
  "nickel",
  "titanium",
  "cupronickel",
  "brass",
];

function buildWhereClause() {
  const conditions = METAL_PATTERNS.map(
    (p) => `(LOWER(COALESCE(metal, '')) LIKE ${mysql.escape("%" + p + "%")})`
  );
  return conditions.join(" OR ");
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

  const where = buildWhereClause();
  const [rows] = await conn.execute(
    `SELECT id, catalog_number, title, metal, face_value, release_date FROM coins WHERE ${where} ORDER BY id`
  );

  console.log("Монеты из недрагоценных металлов (никель, мельхиор, титан, нейзильбер, латунь и т.п.):");
  console.log("Найдено:", rows.length);
  if (rows.length === 0) {
    await conn.end();
    return;
  }
  console.log("");
  rows.slice(0, 30).forEach((r) => {
    console.log("  ", r.id, r.catalog_number, "|", (r.metal || "").slice(0, 40), "|", (r.title || "").slice(0, 50));
  });
  if (rows.length > 30) {
    console.log("  ... и ещё", rows.length - 30);
  }
  console.log("");

  if (DRY_RUN) {
    console.log("Это режим просмотра. Чтобы удалить эти записи, запустите:");
    console.log("  node scripts/remove-non-precious-metal-coins.js --apply");
    await conn.end();
    return;
  }

  const ids = rows.map((r) => r.id);
  const placeholders = ids.map(() => "?").join(",");
  const [result] = await conn.execute(`DELETE FROM coins WHERE id IN (${placeholders})`, ids);
  console.log("Удалено записей:", result.affectedRows);
  await conn.end();
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
