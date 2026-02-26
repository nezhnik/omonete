/**
 * Группа 4 (два двора): приводим к каноническим названиям.
 * - ММД + СПМД (с запятой/тире) → «Московский и Санкт-Петербургский монетные дворы»
 * - ММД + ЛМД → «Московский и Ленинградский монетные дворы»
 * Запуск: node scripts/normalize-mint-group4.js
 */
require("dotenv").config({ path: ".env" });
const mysql = require("mysql2/promise");

const MMD_SPMD_CANONICAL = "Московский и Санкт-Петербургский монетные дворы";
const MMD_SPMD_VARIANTS = [
  "Московский монетный двор, Санкт–Петербургский монетный двор",
  "Московский монетный двор, Санкт-Петербургский монетный двор",
];

const MMD_LMD_CANONICAL = "Московский и Ленинградский монетные дворы";
const MMD_LMD_VARIANTS = ["Московский монетный двор, Ленинградский монетный двор"];

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

  let total = 0;

  console.log("ММД + СПМД → Московский и Санкт-Петербургский монетные дворы");
  for (const variant of MMD_SPMD_VARIANTS) {
    const [res] = await conn.execute(
      "UPDATE coins SET mint = ? WHERE mint = ?",
      [MMD_SPMD_CANONICAL, variant]
    );
    if (res.affectedRows > 0) {
      console.log("  ", variant, "| обновлено:", res.affectedRows);
      total += res.affectedRows;
    }
  }

  console.log("ММД + ЛМД → Московский и Ленинградский монетные дворы");
  for (const variant of MMD_LMD_VARIANTS) {
    const [res] = await conn.execute(
      "UPDATE coins SET mint = ? WHERE mint = ?",
      [MMD_LMD_CANONICAL, variant]
    );
    if (res.affectedRows > 0) {
      console.log("  ", variant, "| обновлено:", res.affectedRows);
      total += res.affectedRows;
    }
  }

  console.log("Готово. Всего обновлено записей:", total);
  await conn.end();
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
