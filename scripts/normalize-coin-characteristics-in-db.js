/**
 * Нормализует характеристики монет в БД: проба (пробелы вокруг /), масса (запятая),
 * диаметр и толщина (пробел перед скобкой). Запускать один раз после внедрения правил.
 *
 * Запуск: node scripts/normalize-coin-characteristics-in-db.js
 */
require("dotenv").config({ path: ".env" });
const mysql = require("mysql2/promise");
const { formatPurity, formatSpaceBeforeParen, formatMass } = require("./format-coin-characteristics.js");

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

  const [rows] = await conn.execute(
    `SELECT id, metal_fineness, weight_g, diameter_mm, thickness_mm FROM coins`
  );

  let updated = 0;
  for (const r of rows) {
    const purity = r.metal_fineness ? formatPurity(r.metal_fineness) : null;
    const weightG = r.weight_g ? formatMass(r.weight_g) : null;
    const diameterMm = r.diameter_mm ? formatSpaceBeforeParen(r.diameter_mm) : null;
    const thicknessMm = r.thickness_mm ? formatSpaceBeforeParen(r.thickness_mm) : null;

    const changed =
      (r.metal_fineness && purity !== r.metal_fineness) ||
      (r.weight_g && weightG !== r.weight_g) ||
      (r.diameter_mm && diameterMm !== r.diameter_mm) ||
      (r.thickness_mm && thicknessMm !== r.thickness_mm);

    if (!changed) continue;

    await conn.execute(
      `UPDATE coins SET metal_fineness = ?, weight_g = ?, diameter_mm = ?, thickness_mm = ? WHERE id = ?`,
      [r.metal_fineness ? purity : null, r.weight_g ? weightG : null, r.diameter_mm ? diameterMm : null, r.thickness_mm ? thicknessMm : null, r.id]
    );
    updated++;
  }

  console.log("Готово. Обновлено записей:", updated, "из", rows.length);
  await conn.end();
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
