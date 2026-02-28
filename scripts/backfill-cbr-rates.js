/**
 * Загрузка курсов ЦБ (USD/RUB) в свою БД — таблица cbr_rates.
 * Один запрос к ЦБ за весь период (GetCursDynamicXML) — как по металлам.
 *
 * Запуск: node scripts/backfill-cbr-rates.js (нужен .env с DATABASE_URL).
 */
require("dotenv").config({ path: ".env" });
const mysql = require("mysql2/promise");

const CBR_SOAP_URL = "https://www.cbr.ru/DailyInfoWebServ/DailyInfo.asmx";
const USD_VALUTA_CODE = "R01235";
const CBR_USD_FIRST_DATE = "1992-07-01"; // с какого числа ЦБ отдаёт ежедневные курсы по API

function getConfig() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL не задан");
  const m = url.match(/mysql:\/\/([^:]+):([^@]+)@([^:]+):(\d+)\/(.+)/);
  if (!m) throw new Error("Неверный формат DATABASE_URL");
  const [, user, password, host, port, database] = m;
  return { host, port: parseInt(port, 10), user, password, database };
}

async function ensureCbrRatesTable(conn) {
  await conn.execute(`
    CREATE TABLE IF NOT EXISTS cbr_rates (
      date DATE NOT NULL PRIMARY KEY,
      usd_rub DECIMAL(12,4) NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
}

/** Один запрос к ЦБ за весь диапазон — возвращает [{ date, usd_rub }]. */
async function fetchCbrUsdRange(fromDate, toDate) {
  const fromStr = fromDate.toISOString().slice(0, 10);
  const toStr = toDate.toISOString().slice(0, 10);
  const body = `<?xml version="1.0" encoding="utf-8"?><soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema"><soap:Body><GetCursDynamicXML xmlns="http://web.cbr.ru/"><FromDate>${fromStr}T00:00:00</FromDate><ToDate>${toStr}T00:00:00</ToDate><ValutaCode>${USD_VALUTA_CODE}</ValutaCode></GetCursDynamicXML></soap:Body></soap:Envelope>`;
  const res = await fetch(CBR_SOAP_URL, {
    method: "POST",
    headers: {
      "Content-Type": "text/xml; charset=utf-8",
      "SOAPAction": "http://web.cbr.ru/GetCursDynamicXML",
    },
    body,
  });
  const xml = await res.text();
  const rows = [];
  const re = /<ValuteCursDynamic[^>]*>[\s\S]*?<CursDate[^>]*>([^<]+)<[\s\S]*?<Vnom[^>]*>([^<]+)<[\s\S]*?<Vcurs[^>]*>([^<]+)</gi;
  let m;
  while ((m = re.exec(xml)) !== null) {
    const dateStr = m[1].slice(0, 10);
    const nominal = Number(m[2].replace(",", ".")) || 1;
    const curs = Number(m[3].replace(",", "."));
    if (dateStr && curs > 0) rows.push({ date: dateStr, usd_rub: curs / nominal });
  }
  return rows;
}

async function main() {
  const conn = await mysql.createConnection(getConfig());
  await ensureCbrRatesTable(conn);

  const fromDate = new Date(CBR_USD_FIRST_DATE + "T12:00:00");
  const toDate = new Date();
  const toStr = toDate.toISOString().slice(0, 10);

  console.log("Запрос к ЦБ: курс USD с", CBR_USD_FIRST_DATE, "по", toStr, "...");
  const rows = await fetchCbrUsdRange(fromDate, toDate);
  if (!rows.length) {
    console.log("ЦБ не вернул данных.");
    await conn.end();
    return;
  }
  console.log("Получено", rows.length, "дней. Запись в БД...");
  const BATCH = 500;
  for (let i = 0; i < rows.length; i += BATCH) {
    const chunk = rows.slice(i, i + BATCH);
    const values = chunk.map((r) => [r.date, r.usd_rub]);
    const placeholders = chunk.map(() => "(?, ?)").join(", ");
    const flat = values.flat();
    await conn.execute(
      `INSERT INTO cbr_rates (date, usd_rub) VALUES ${placeholders} ON DUPLICATE KEY UPDATE usd_rub = VALUES(usd_rub)`,
      flat
    );
  }
  console.log("✓ Курсы ЦБ в БД (cbr_rates):", rows.length, "записей,", rows[0]?.date, "…", rows[rows.length - 1]?.date);
  await conn.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
