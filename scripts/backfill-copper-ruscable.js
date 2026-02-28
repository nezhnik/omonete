/**
 * Медь: RusCable LME (USD/т) + курс ЦБ из БД (cbr_rates) → руб/г, запись в metal_prices.xcu.
 * Курсы ЦБ должны быть заранее в БД: node scripts/backfill-cbr-rates.js (2006–сегодня).
 * RusCable отдаёт данные с 2006 года.
 *
 * Запуск: node scripts/backfill-copper-ruscable.js (нужен .env с DATABASE_URL).
 */
require("dotenv").config({ path: ".env" });
const mysql = require("mysql2/promise");

const RUSCABLE_URL = "https://www.ruscable.ru/quotation/assets/ajax/lme.php";

function getConfig() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL не задан");
  const m = url.match(/mysql:\/\/([^:]+):([^@]+)@([^:]+):(\d+)\/(.+)/);
  if (!m) throw new Error("Неверный формат DATABASE_URL");
  const [, user, password, host, port, database] = m;
  return { host, port: parseInt(port, 10), user, password, database };
}

async function fetchRuscableRange(dateFrom, dateTo) {
  const url = `${RUSCABLE_URL}?date_from=${dateFrom}&date_to=${dateTo}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error("RusCable: " + res.status);
  const data = await res.json();
  const dates = data?.copper?.dates || [];
  const ranks = data?.copper?.ranks || [];
  return dates.map((d, i) => ({ date: d, usdPerTonne: Number(ranks[i]) || 0 })).filter((r) => r.usdPerTonne > 0);
}

async function main() {
  const conn = await mysql.createConnection(getConfig());
  const fromYear = 2006;
  const toDate = new Date();
  const toStr = toDate.toISOString().slice(0, 10);

  let total = 0;
  let updated = 0;
  let noRate = 0;
  for (let y = fromYear; y <= toDate.getFullYear(); y++) {
    const start = y === fromYear ? "2006-01-01" : `${y}-01-01`;
    const end = y === toDate.getFullYear() ? toStr : `${y}-12-31`;
    const rows = await fetchRuscableRange(start, end);
    if (!rows.length) continue;
    total += rows.length;
    for (const r of rows) {
      const [rows2] = await conn.execute("SELECT usd_rub FROM cbr_rates WHERE date = ?", [r.date]);
      const row = rows2 && rows2[0];
      const usdRub = row?.usd_rub != null ? Number(row.usd_rub) : null;
      if (usdRub == null || usdRub <= 0) {
        noRate++;
        continue;
      }
      const xcu = (r.usdPerTonne / 1_000_000) * usdRub;
      const [result] = await conn.execute("UPDATE metal_prices SET xcu = ? WHERE date = ?", [xcu, r.date]);
      updated += result.affectedRows;
    }
    if (rows.length) console.log(y, "→", rows.length, "дней медь");
    await new Promise((r) => setTimeout(r, 300));
  }

  console.log("✓ RusCable медь (2006–сегодня): обработано", total, "дней, обновлено в БД:", updated);
  if (noRate) console.log("  Пропущено (нет курса ЦБ в cbr_rates):", noRate, "— запустите node scripts/backfill-cbr-rates.js");
  await conn.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
