/**
 * Крон 1 раз в день: (1) запрос к ЦБ РФ → запись в metal_prices, (2) чтение из БД → public/data/metal-prices.json.
 * Запуск: node scripts/cron-metal-prices.js (нужен .env с DATABASE_URL).
 * Один раз догрузить историю с 2003-07: BACKFILL_FROM_2003=1 FORCE_METAL_CRON=1 node scripts/cron-metal-prices.js
 */
require("dotenv").config({ path: ".env" });
const mysql = require("mysql2/promise");
const fs = require("fs");
const path = require("path");

const CBR_SOAP_URL = "https://www.cbr.ru/DailyInfoWebServ/DailyInfo.asmx";
const CBR_COD = { 1: "xau", 2: "xag", 3: "xpt", 4: "xpd" };
const DATA_DIR = path.join(__dirname, "..", "public", "data");
const OUTPUT_FILE = path.join(DATA_DIR, "metal-prices.json");

/** ЦБ публикует цены только в рабочие дни (пн–пт). Суббота и воскресенье — не запрашиваем. */
function isCbrWorkingDay() {
  const d = new Date();
  const day = d.getDay();
  return day !== 0 && day !== 6;
}

/** Для одноразового ручного запуска: FORCE_METAL_CRON=1 node scripts/cron-metal-prices.js — выполнить даже в выходной. */
function shouldRunCron() {
  if (process.env.FORCE_METAL_CRON === "1") return true;
  return isCbrWorkingDay();
}

function getConfig() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL не задан");
  const m = url.match(/mysql:\/\/([^:]+):([^@]+)@([^:]+):(\d+)\/(.+)/);
  if (!m) throw new Error("Неверный формат DATABASE_URL");
  const [, user, password, host, port, database] = m;
  return { host, port: parseInt(port, 10), user, password, database };
}

/** Запрос к ЦБ за диапазон дат (макс ~365 дней за запрос). Возвращает [{ date, xau, xag, xpt, xpd }]. */
async function fetchCbrRange(startDate, endDate) {
  const fromDateTime = `${startDate}T00:00:00`;
  const toDateTime = `${endDate}T00:00:00`;
  const body = `<?xml version="1.0" encoding="utf-8"?><soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema"><soap:Body><DragMetDynamic xmlns="http://web.cbr.ru/"><fromDate>${fromDateTime}</fromDate><ToDate>${toDateTime}</ToDate></DragMetDynamic></soap:Body></soap:Envelope>`;
  const res = await fetch(CBR_SOAP_URL, {
    method: "POST",
    headers: {
      "Content-Type": "text/xml; charset=utf-8",
      "SOAPAction": "http://web.cbr.ru/DragMetDynamic",
    },
    body,
  });
  const xml = await res.text();
  const all = [];
  const drgMatches = xml.matchAll(/<DrgMet[^>]*>([\s\S]*?)<\/DrgMet>/gi);
  for (const m of drgMatches) {
    const block = m[1];
    const dateMet = block.match(/<DateMet[^>]*>([^<]+)</)?.[1];
    const codMet = block.match(/<CodMet[^>]*>([^<]+)</)?.[1];
    const price = block.match(/<price[^>]*>([^<]+)</)?.[1];
    if (dateMet && codMet && price) {
      const date = dateMet.slice(0, 10);
      const cod = Number(codMet);
      const col = CBR_COD[cod];
      if (col) all.push({ date, cod: col, price: Number(price.replace(",", ".")) });
    }
  }
  const byDate = new Map();
  for (const { date, cod, price } of all) {
    let row = byDate.get(date);
    if (!row) { row = { date, xau: 0, xag: 0, xpt: 0, xpd: 0 }; byDate.set(date, row); }
    row[cod] = price;
  }
  return Array.from(byDate.values()).sort((a, b) => a.date.localeCompare(b.date));
}

/** Создать таблицу metal_prices, если её ещё нет. */
async function ensureTable(conn) {
  await conn.execute(`
    CREATE TABLE IF NOT EXISTS metal_prices (
      id INT AUTO_INCREMENT PRIMARY KEY,
      date DATE NOT NULL UNIQUE,
      xau DECIMAL(12,4) NOT NULL DEFAULT 0,
      xag DECIMAL(12,4) NOT NULL DEFAULT 0,
      xpt DECIMAL(12,4) NOT NULL DEFAULT 0,
      xpd DECIMAL(12,4) NOT NULL DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
  try {
    await conn.execute("CREATE INDEX idx_metal_prices_date ON metal_prices (date)");
  } catch (e) {
    if (e.code !== "ER_DUP_KEYNAME") throw e;
  }
}

/** Вставить массив строк в БД (ON DUPLICATE KEY UPDATE). */
function insertRows(conn, rows) {
  return Promise.all(
    rows.map((r) =>
      conn.execute(
        "INSERT INTO metal_prices (date, xau, xag, xpt, xpd) VALUES (?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE xau=VALUES(xau), xag=VALUES(xag), xpt=VALUES(xpt), xpd=VALUES(xpd)",
        [r.date, r.xau, r.xag, r.xpt, r.xpd]
      )
    )
  );
}

/** Заполнить БД за последние 10 лет чанками по 365 дней (как в API: те же диапазоны для графиков 1m–10y). */
async function fetchBackfill10y(conn) {
  const end = new Date();
  const to = (d) => d.toISOString().slice(0, 10);
  let total = 0;
  for (let i = 0; i < 10; i++) {
    const yEnd = new Date(end);
    yEnd.setFullYear(yEnd.getFullYear() - (9 - i));
    const yStart = new Date(yEnd);
    yStart.setFullYear(yStart.getFullYear() - 1);
    const startStr = to(yStart);
    const endStr = to(yEnd);
    const rows = await fetchCbrRange(startStr, endStr);
    if (rows.length) {
      await insertRows(conn, rows);
      total += rows.length;
    }
  }
  if (total) console.log("✓ ЦБ → БД (10 лет):", total, "дней");
}

/** Догрузить историю с 2003-07-07 до начала последних 10 лет (для периода «Все»). */
async function fetchBackfillFrom2003(conn) {
  const end = new Date();
  end.setFullYear(end.getFullYear() - 10);
  const to = (d) => d.toISOString().slice(0, 10);
  const start = new Date("2003-07-07T12:00:00");
  let total = 0;
  let cur = new Date(start);
  while (cur < end) {
    const next = new Date(cur);
    next.setFullYear(next.getFullYear() + 1);
    const endCur = next > end ? end : new Date(next.getTime() - 86400000);
    const rows = await fetchCbrRange(to(cur), to(endCur));
    if (rows.length) {
      await insertRows(conn, rows);
      total += rows.length;
    }
    cur = next;
  }
  if (total) console.log("✓ ЦБ → БД (с 2003 г.):", total, "дней");
}

/** Добавить последние несколько дней (для ежедневного крона). */
async function fetchAndInsert(conn, days = 3) {
  const end = new Date();
  const start = new Date(end);
  start.setDate(start.getDate() - days);
  const startStr = start.toISOString().slice(0, 10);
  const endStr = end.toISOString().slice(0, 10);
  const rows = await fetchCbrRange(startStr, endStr);
  if (!rows.length) return;
  await insertRows(conn, rows);
  console.log("✓ ЦБ → БД (свежие):", rows.length, "дней");
}

function to(d) {
  return d.toISOString().slice(0, 10);
}

/** Из всех строк БД выбрать диапазон по периоду. */
function getRangeForPeriod(rows, period) {
  const end = new Date();
  const CBR_FIRST_DATE = "2003-07-07";
  let start;
  if (period === "1m") {
    start = new Date(end); start.setMonth(start.getMonth() - 1);
  } else if (period === "1y") {
    start = new Date(end); start.setFullYear(start.getFullYear() - 1);
  } else if (period === "5y") {
    start = new Date(end); start.setFullYear(start.getFullYear() - 5);
  } else if (period === "10y") {
    start = new Date(end); start.setFullYear(start.getFullYear() - 10);
  } else if (period === "all") {
    start = new Date(CBR_FIRST_DATE + "T12:00:00");
  } else return [];
  const startStr = to(start);
  const endStr = to(end);
  return rows.filter((r) => r.date >= startStr && r.date <= endStr);
}

/** Собрать ответ в формате API для одного периода (1m, 1y, 5y, 10y, all). */
function buildPeriodResponse(rows, period) {
  const range = getRangeForPeriod(rows, period);
  if (!range.length) return null;
  let sampled;
  if (period === "all") {
    const byMonth = new Map();
    range.forEach((r) => byMonth.set(r.date.slice(0, 7), r));
    const keys = Array.from(byMonth.keys()).sort();
    sampled = keys.map((k) => {
      const r = byMonth.get(k);
      const d = new Date(r.date + "T12:00:00");
      return {
        label: d.toLocaleDateString("ru-RU", { month: "short", year: "2-digit" }),
        ...r,
      };
    });
  } else if (period === "5y" || period === "10y") {
    const getWeekKey = (dateStr) => {
      const d = new Date(dateStr + "T12:00:00");
      const day = d.getDay();
      const mon = new Date(d);
      mon.setDate(d.getDate() - (day === 0 ? 6 : day - 1));
      return mon.toISOString().slice(0, 10);
    };
    const byWeek = new Map();
    range.forEach((r) => byWeek.set(getWeekKey(r.date), r));
    const keys = Array.from(byWeek.keys()).sort();
    sampled = keys.map((k) => {
      const r = byWeek.get(k);
      return {
        label: new Date(r.date).toLocaleDateString("ru-RU", { day: "numeric", month: "short", year: "2-digit" }),
        ...r,
      };
    });
  } else {
    sampled = range.map((r) => {
      const d = new Date(r.date + "T12:00:00");
      const formatOptions =
        period === "1y"
          ? { day: "numeric", month: "short", year: "2-digit" }
          : { day: "numeric", month: "short" };
      return {
        label: d.toLocaleDateString("ru-RU", formatOptions),
        ...r,
      };
    });
  }
  const round = (v) => Math.round(Number(v) * 100) / 100;
  return {
    ok: true,
    period,
    source: "static",
    XAU: sampled.map((s) => ({ label: s.label, value: round(s.xau) })),
    XAG: sampled.map((s) => ({ label: s.label, value: round(s.xag) })),
    XPT: sampled.map((s) => ({ label: s.label, value: round(s.xpt) })),
    XPD: sampled.map((s) => ({ label: s.label, value: round(s.xpd) })),
  };
}

async function main() {
  const conn = await mysql.createConnection(getConfig());
  try {
    await ensureTable(conn);
    const [[{ cnt }]] = await conn.execute("SELECT COUNT(*) AS cnt FROM metal_prices");
    const needBackfill = (cnt || 0) < 500;
    const forceBackfill = process.env.BACKFILL_FROM_2003 === "1";
    const workingDay = shouldRunCron();

    if ((needBackfill || forceBackfill) && workingDay) {
      if (needBackfill) {
        await fetchBackfill10y(conn);
      }
      await fetchBackfillFrom2003(conn);
    } else if (needBackfill && !workingDay) {
      console.log("⊘ Бэкфилл пропущен (выходной ЦБ), новых данных нет — запусти крон в рабочий день.");
    }

    if (workingDay) {
      await fetchAndInsert(conn, 3);
    } else {
      console.log("⊘ Выходной ЦБ: запрос и экспорт пропущены. Для принудительного запуска: FORCE_METAL_CRON=1 node scripts/cron-metal-prices.js");
      return;
    }

    const [rows] = await conn.execute(
      "SELECT date, xau, xag, xpt, xpd FROM metal_prices ORDER BY date"
    );
    const allRows = (rows || []).map((r) => ({
      date: r.date instanceof Date ? r.date.toISOString().slice(0, 10) : String(r.date).slice(0, 10),
      xau: Number(r.xau),
      xag: Number(r.xag),
      xpt: Number(r.xpt),
      xpd: Number(r.xpd),
    }));

    const out = {};
    for (const p of ["1m", "1y", "5y", "10y", "all"]) {
      const resp = buildPeriodResponse(allRows, p);
      if (resp && resp.XAU && resp.XAU.length) out[p] = resp;
    }

    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(OUTPUT_FILE, JSON.stringify(out, null, 0), "utf8");
    console.log("✓ БД →", OUTPUT_FILE);
  } finally {
    await conn.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
