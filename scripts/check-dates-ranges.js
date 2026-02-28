/**
 * Проверка диапазонов дат в БД: курс доллара (cbr_rates), медь (metal_prices.xcu).
 * Запуск: node scripts/check-dates-ranges.js
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

async function main() {
  const conn = await mysql.createConnection(getConfig());

  const [[cbr]] = await conn.execute(
    "SELECT COUNT(*) AS cnt, MIN(date) AS min_d, MAX(date) AS max_d FROM cbr_rates"
  );
  const [[xcu]] = await conn.execute(
    "SELECT COUNT(*) AS cnt, MIN(date) AS min_d, MAX(date) AS max_d FROM metal_prices WHERE xcu > 0"
  );

  console.log("Курс доллара (cbr_rates):", cbr.cnt, "дней, с", cbr.min_d, "по", cbr.max_d);
  console.log("Медь (metal_prices.xcu):", xcu.cnt, "дней, с", xcu.min_d, "по", xcu.max_d);

  const usdFrom1990s = cbr.min_d && cbr.min_d.getFullYear() <= 1999;
  const xcuFrom2006 = xcu.min_d && xcu.min_d.getFullYear() <= 2006;

  if (usdFrom1990s) console.log("✓ Курс доллара с 1990-х");
  else console.log("⚠ Курс доллара: ожидалось с 1990-х, фактически с", cbr.min_d);
  if (xcuFrom2006) console.log("✓ Медь с 2006");
  else console.log("⚠ Медь: ожидалось с 2006, фактически с", xcu.min_d);

  const [[mar17feb18]] = await conn.execute(
    "SELECT COUNT(*) AS n FROM metal_prices WHERE date >= '2017-03-01' AND date <= '2018-02-28' AND xcu > 0"
  );
  const [oct17] = await conn.execute(
    "SELECT date, ROUND(xcu, 2) AS xcu FROM metal_prices WHERE date >= '2017-10-20' AND date <= '2017-10-28' AND xcu > 0 ORDER BY date"
  );
  console.log("Март 2017 — фев 2018: дней с ценой меди", mar17feb18.n);
  if (oct17.length) console.log("Пример 24 окт. 2017:", oct17.find((r) => String(r.date).includes("2017-10-24"))?.xcu ?? oct17);

  await conn.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
