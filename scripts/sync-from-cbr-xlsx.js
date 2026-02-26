/**
 * Полная замена каталога в БД строками из Excel ЦБ.
 * Файл должен быть уже без недрагоценных металлов — в БД останутся только строки из xlsx.
 *
 * Запуск: node scripts/sync-from-cbr-xlsx.js
 *         (файл: RC_F01_01_1992_T06_02_2026-2.xlsx в корне omonete-app)
 */
require("dotenv").config({ path: ".env" });
const mysql = require("mysql2/promise");
const X = require("xlsx");
const path = require("path");
const fs = require("fs");
const { formatPurity } = require("./format-coin-characteristics.js");

const XLSX_PATH = path.join(__dirname, "..", "RC_F01_01_1992_T06_02_2026-2.xlsx");

function parseReleaseDate(val) {
  if (val == null || val === "") return null;
  let d;
  if (typeof val === "number") {
    d = new Date((val - 25569) * 86400 * 1000);
  } else if (typeof val === "string") {
    d = new Date(val);
  } else {
    return null;
  }
  if (isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

function parseMetalFineness(metalStr) {
  if (!metalStr || typeof metalStr !== "string") return null;
  const m = metalStr.match(/\d{3,4}\/\d{3,4}/);
  return m ? m[0] : null;
}

/** Суффикс каталожного номера: 5111-0178-26 → "26" (последние две цифры года). */
function parseCatalogSuffix(partNumber) {
  if (!partNumber || typeof partNumber !== "string") return null;
  const m = String(partNumber).trim().match(/-(\d{2})$/);
  return m ? m[1] : null;
}

async function run() {
  if (!fs.existsSync(XLSX_PATH)) {
    console.error("Файл не найден:", XLSX_PATH);
    process.exit(1);
  }

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

  const wb = X.readFile(XLSX_PATH);
  const sh = wb.Sheets[wb.SheetNames[0]];
  const rows = X.utils.sheet_to_json(sh, { header: 1, raw: false });
  const dataRows = rows.slice(1).filter((r) => r && r[0] && r[2]); // part_number и cname

  console.log("Строк в xlsx (только драгметаллы):", dataRows.length);

  // Полная замена: очистить таблицу и вставить только строки из xlsx
  await conn.execute("DELETE FROM coins");
  console.log("Таблица coins очищена.");

  // Проверяем наличие catalog_suffix (может быть старый слой БД)
  const [colList] = await conn.execute(
    `SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'coins' AND COLUMN_NAME = 'catalog_suffix'`
  );
  const hasSuffix = colList.length > 0;

  const insertSql = hasSuffix
    ? `INSERT INTO coins (catalog_number, catalog_suffix, title, series, face_value, metal, metal_fineness, release_date)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    : `INSERT INTO coins (catalog_number, title, series, face_value, metal, metal_fineness, release_date)
       VALUES (?, ?, ?, ?, ?, ?, ?)`;

  let inserted = 0;
  for (const row of dataRows) {
    const partNumber = String(row[0]).trim();
    const catalogSuffix = parseCatalogSuffix(partNumber);
    const title = row[2] ? String(row[2]).trim() : null;
    const series = row[3] != null && row[3] !== "" ? String(row[3]).trim() : null;
    const faceValue = row[4] != null && row[4] !== "" ? String(row[4]).trim() : null;
    const metal = row[5] != null && row[5] !== "" ? String(row[5]).trim() : null;
    const rawFineness = parseMetalFineness(metal);
    const metalFineness = rawFineness ? formatPurity(rawFineness) : null;
    const releaseDate = parseReleaseDate(row[1]);
    if (!title) continue;

    if (hasSuffix) {
      await conn.execute(insertSql, [
        partNumber,
        catalogSuffix,
        title,
        series || null,
        faceValue || null,
        metal || null,
        metalFineness,
        releaseDate,
      ]);
    } else {
      await conn.execute(insertSql, [
        partNumber,
        title,
        series || null,
        faceValue || null,
        metal || null,
        metalFineness,
        releaseDate,
      ]);
    }
    inserted++;
  }

  await conn.end();
  console.log("Вставлено записей из xlsx:", inserted);
  console.log("В БД только монеты из файла (без недрагоценных). Дальше: скачать картинки — download-dzi-coins-by-base.js");
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
