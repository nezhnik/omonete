/**
 * Однократное исправление меди: пересчитать xcu за последние 7 дней по RusCable + cbr_rates.
 * Запуск: node scripts/fix-copper-last-days.js
 * Использовать после исправления бага с GRAMS_PER_TROY_OZ в кроне.
 */
require("dotenv").config({ path: ".env" });
const mysql = require("mysql2/promise");
const path = require("path");

const RUSCABLE_URL = "https://www.ruscable.ru/quotation/assets/ajax/lme.php";
const GRAMS_PER_TROY_OZ = 31.1035;

function getConfig() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL не задан");
  const m = url.match(/mysql:\/\/([^:]+):([^@]+)@([^:]+):(\d+)\/(.+)/);
  if (!m) throw new Error("Неверный формат DATABASE_URL");
  const [, user, password, host, port, database] = m;
  return { host, port: parseInt(port, 10), user, password, database };
}

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
  const end = new Date();
  const start = new Date(end);
  start.setDate(start.getDate() - 7);
  const dateFrom = start.toISOString().slice(0, 10);
  const dateTo = end.toISOString().slice(0, 10);

  const res = await fetch(`${RUSCABLE_URL}?date_from=${dateFrom}&date_to=${dateTo}`);
  if (!res.ok) throw new Error("RusCable: " + res.status);
  const data = await res.json();
  const dates = data?.copper?.dates || [];
  const ranks = data?.copper?.ranks || [];

  let updated = 0;
  for (let i = 0; i < dates.length; i++) {
    const dateStr = dates[i];
    const usdPerTonne = Number(ranks[i]);
    if (!usdPerTonne || !dateStr) continue;
    const usdRub = await getUsdRubForDate(conn, dateStr);
    if (usdRub == null || usdRub <= 0) {
      console.log("⊘ Пропуск", dateStr, "(нет курса ЦБ)");
      continue;
    }
    const rubPerGram = (usdPerTonne / 1_000_000) * usdRub;
    const xcu = Math.round(rubPerGram * GRAMS_PER_TROY_OZ * 100) / 100;
    const [r] = await conn.execute("UPDATE metal_prices SET xcu = ? WHERE date = ?", [xcu, dateStr]);
    if (r.affectedRows) {
      console.log("✓", dateStr, "→ xcu =", xcu, "₽/унция");
      updated++;
    }
  }

  console.log("\nОбновлено строк:", updated);
  console.log("Дальше запусти крон для перезаписи metal-prices.json: npm run metal-prices:cron");
  await conn.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
