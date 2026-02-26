require("dotenv").config({ path: ".env" });
const mysql = require("mysql2/promise");
const X = require("xlsx");
const path = require("path");
const { formatPurity } = require("./format-coin-characteristics.js");

function parseReleaseYear(val) {
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
  const year = d.getFullYear();
  return `${year}-01-01`;
}

function parseMetalFineness(metalAndFineness) {
  if (!metalAndFineness || typeof metalAndFineness !== "string") return null;
  const m = metalAndFineness.match(/\d{3,4}\/\d{3,4}/);
  return m ? m[0] : null;
}

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

  const xlsxPath = path.join(__dirname, "..", "RC_F01_01_1992_T06_02_2026.xlsx");
  const wb = X.readFile(xlsxPath);
  const sh = wb.Sheets[wb.SheetNames[0]];
  const rows = X.utils.sheet_to_json(sh, { header: 1, raw: true });

  const headers = rows[0];
  const dataRows = rows.slice(1).filter((r) => r && r.length && r[2]); // есть название монеты

  const conn = await mysql.createConnection({
    host,
    port: parseInt(port, 10),
    user,
    password,
    database,
  });

  const insertSql = `
    INSERT INTO coins (catalog_number, title, series, face_value, metal, metal_fineness, release_date)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `;

  let inserted = 0;
  let skipped = 0;

  for (const row of dataRows) {
    const catalogNum = row[0];
    const dateVal = row[1];
    const title = row[2] ? String(row[2]).trim() : null;
    const series = row[3] != null && row[3] !== "" ? String(row[3]).trim() : null;
    const faceValue = row[4] != null && row[4] !== "" ? String(row[4]).trim() : null;
    const metalAndFineness = row[5] != null && row[5] !== "" ? String(row[5]).trim() : null;
    if (!title) {
      skipped++;
      continue;
    }

    const releaseDate = parseReleaseYear(dateVal);
    const metal = metalAndFineness;
    const rawFineness = parseMetalFineness(metalAndFineness);
    const metalFineness = rawFineness ? formatPurity(rawFineness) : null;

    const catNum = catalogNum != null && String(catalogNum).trim() !== "" ? String(catalogNum).trim() : null;
    try {
      await conn.execute(insertSql, [
        catNum,
        title,
        series || null,
        faceValue || null,
        metal || null,
        metalFineness,
        releaseDate,
      ]);
      inserted++;
    } catch (err) {
      console.error("Ошибка вставки:", title?.slice(0, 50), err.message);
    }
  }

  await conn.end();
  console.log("✓ Импорт завершён. Вставлено:", inserted, "Пропущено:", skipped);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
