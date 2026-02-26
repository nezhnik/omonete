/**
 * Объединяет варианты написания монетных дворов (группы 2 и 3):
 * - Московский: все варианты → «Московский монетный двор»
 * - Ленинградский: «Лениградский» → «Ленинградский монетный двор»
 * Запуск: node scripts/normalize-mint-2-and-3.js
 */
require("dotenv").config({ path: ".env" });
const mysql = require("mysql2/promise");

const MOSCOW_CANONICAL = "Московский монетный двор";
const MOSCOW_VARIANTS = [
  "Московский Монетный Двор",
  "Московский монетный двор (MМД)",
  "Московский монетный двор (ММД",
  "Московкий монетный двор",
];

const LENINGRAD_CANONICAL = "Ленинградский монетный двор";
const LENINGRAD_VARIANTS = ["Лениградский монетный двор"];

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

  for (const variant of MOSCOW_VARIANTS) {
    const [res] = await conn.execute(
      "UPDATE coins SET mint = ? WHERE mint = ?",
      [MOSCOW_CANONICAL, variant]
    );
    if (res.affectedRows > 0) {
      console.log("Московский:", variant, "→", MOSCOW_CANONICAL, "| обновлено:", res.affectedRows);
      total += res.affectedRows;
    }
  }

  for (const variant of LENINGRAD_VARIANTS) {
    const [res] = await conn.execute(
      "UPDATE coins SET mint = ? WHERE mint = ?",
      [LENINGRAD_CANONICAL, variant]
    );
    if (res.affectedRows > 0) {
      console.log("Ленинградский:", variant, "→", LENINGRAD_CANONICAL, "| обновлено:", res.affectedRows);
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
