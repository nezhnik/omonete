/**
 * Группа 1 (СПМД):
 * 1) Варианты с двумя дворами (СПМД + ММД) → перенос в группу 4: «Московский и Санкт-Петербургский монетные дворы»
 * 2) Все варианты «только СПМД» → «Санкт-Петербургский монетный двор»
 * Запуск: node scripts/normalize-mint-group1.js
 */
require("dotenv").config({ path: ".env" });
const mysql = require("mysql2/promise");

const TWO_MINTS_CANONICAL = "Московский и Санкт-Петербургский монетные дворы";
const TWO_MINTS_FROM_GROUP1 = [
  "Санкт-Петербургский монетный двор, Московский монетный двор",
  "Санкт-Петербургский монетный двор Московский монетный двор",
];

const SPB_CANONICAL = "Санкт-Петербургский монетный двор";
const SPB_VARIANTS = [
  "Cанкт-Петербургский монетный двор",
  "Санкт-Петербургский монетный двор СПМД)",
  "Санкт Петербургский",
  "Чеканка: Санкт-Петербургский монетный двор",
  "Санкт-Петергбургский монетный двор",
  "Санкт-Петергбурский монетный двор",
  "Санкт-Петербугрский монетный двор",
];

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

  console.log("1) Два двора (СПМД+ММД) → группа 4");
  for (const variant of TWO_MINTS_FROM_GROUP1) {
    const [res] = await conn.execute(
      "UPDATE coins SET mint = ? WHERE mint = ?",
      [TWO_MINTS_CANONICAL, variant]
    );
    if (res.affectedRows > 0) {
      console.log("  ", variant, "→", TWO_MINTS_CANONICAL, "| обновлено:", res.affectedRows);
      total += res.affectedRows;
    }
  }

  console.log("2) Только СПМД → Санкт-Петербургский монетный двор");
  for (const variant of SPB_VARIANTS) {
    const [res] = await conn.execute(
      "UPDATE coins SET mint = ? WHERE mint = ?",
      [SPB_CANONICAL, variant]
    );
    if (res.affectedRows > 0) {
      console.log("  ", variant, "→", SPB_CANONICAL, "| обновлено:", res.affectedRows);
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
