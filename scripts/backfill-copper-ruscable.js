/**
 * Медь: RusCable LME (USD/т) + курс ЦБ из БД (cbr_rates) → руб/г, запись в metal_prices.xcu.
 * Курсы ЦБ должны быть заранее в БД: node scripts/backfill-cbr-rates.js (2006–сегодня).
 * RusCable отдаёт данные с 2006 года.
 * Если на дату LME нет курса ЦБ (выходной/праздник РФ), берётся последний известный курс (напр. пятница для субботы).
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

/** Курс ЦБ на дату или последний известный на эту дату/раньше (для выходных — курс пятницы и т.п.). */
async function getUsdRubForDate(conn, dateStr) {
  const [exact] = await conn.execute("SELECT usd_rub FROM cbr_rates WHERE date = ?", [dateStr]);
  if (exact?.[0]?.usd_rub != null) return Number(exact[0].usd_rub);
  const [prev] = await conn.execute(
    "SELECT usd_rub FROM cbr_rates WHERE date <= ? ORDER BY date DESC LIMIT 1",
    [dateStr]
  );
  return prev?.[0]?.usd_rub != null ? Number(prev[0].usd_rub) : null;
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
      const usdRub = await getUsdRubForDate(conn, r.date);
      if (usdRub == null || usdRub <= 0) {
        noRate++;
        continue;
      }
      const xcu = (r.usdPerTonne / 1_000_000) * usdRub;
      await conn.execute(
        "INSERT INTO metal_prices (date, xau, xag, xpt, xpd, xcu) VALUES (?, 0, 0, 0, 0, ?) ON DUPLICATE KEY UPDATE xcu = VALUES(xcu)",
        [r.date, xcu]
      );
      updated++;
    }
    if (rows.length) console.log(y, "→", rows.length, "дней медь");
    await new Promise((r) => setTimeout(r, 300));
  }

  console.log("✓ RusCable медь (2006–сегодня): обработано", total, "дней, записано в БД:", updated);
  if (noRate) console.log("  Пропущено (нет курса ЦБ даже по предыдущим датам):", noRate);
  await conn.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
