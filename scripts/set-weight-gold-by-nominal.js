/**
 * Вес по номиналу и металлу:
 * Золото: 25р→1/10 oz, 50р→1/4, 100р→1/2, 200р→1 oz, 1 000р→5 oz, 10 000р→1 кг, 25 000р→3 кг, 50 000р→5 кг. Искл.: 10р Сеятель 2023→1/4.
 * Платина: 25р→1/10, 50р→1/4, 150р→1/2 унции.
 * Палладий: 5р→1/4 унции.
 * Запуск: node scripts/set-weight-gold-by-nominal.js → npm run data:export
 */
require("dotenv").config({ path: ".env" });
const mysql = require("mysql2/promise");

const GOLD_RULES = [
  { faceValue: "25 рублей", weightG: "3.11", weightOz: "1/10 унции" },
  { faceValue: "50 рублей", weightG: "7.78", weightOz: "1/4 унции" },
  { faceValue: "100 рублей", weightG: "15.55", weightOz: "1/2 унции" },
  { faceValue: "200 рублей", weightG: "31.1", weightOz: "1 унция" },
  { faceValue: "1000 рублей", weightG: "155.52", weightOz: "5 унций" },
  { faceValue: "1 000 рублей", weightG: "155.52", weightOz: "5 унций" },
  { faceValue: "10000 рублей", weightG: "1000", weightOz: "1 кг" },
  { faceValue: "10 000 рублей", weightG: "1000", weightOz: "1 кг" },
  { faceValue: "25 000 рублей", weightG: "3000", weightOz: "3 кг" },
  { faceValue: "50 000 рублей", weightG: "5000", weightOz: "5 кг" },
];

const PLATINUM_RULES = [
  { faceValue: "25 рублей", weightG: "3.11", weightOz: "1/10 унции" },
  { faceValue: "50 рублей", weightG: "7.78", weightOz: "1/4 унции" },
  { faceValue: "150 рублей", weightG: "15.55", weightOz: "1/2 унции" },
];

const PALLADIUM_RULES = [{ faceValue: "5 рублей", weightG: "7.78", weightOz: "1/4 унции" }];

async function run() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL не задан в .env");
    process.exit(1);
  }
  const conn = await mysql.createConnection(url);

  const hasWeightOz = await conn
    .execute("SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'coins' AND COLUMN_NAME = 'weight_oz'")
    .then(([r]) => r.length > 0)
    .catch(() => false);

  const update = async (whereSql, params, weightG, weightOz) => {
    const sql =
      hasWeightOz
        ? `UPDATE coins SET weight_g = ?, weight_oz = ? WHERE ${whereSql}`
        : `UPDATE coins SET weight_g = ? WHERE ${whereSql}`;
    const values = hasWeightOz ? [weightG, weightOz, ...params] : [weightG, ...params];
    const [result] = await conn.execute(sql, values);
    return result.affectedRows;
  };

  let total = 0;

  for (const r of GOLD_RULES) {
    const n = await update(
      "face_value = ? AND (LOWER(COALESCE(metal, '')) LIKE '%золото%')",
      [r.faceValue],
      r.weightG,
      r.weightOz
    );
    console.log("Au", r.faceValue, "→", r.weightOz, ":", n);
    total += n;
  }

  for (const r of PLATINUM_RULES) {
    const n = await update(
      "face_value = ? AND (LOWER(COALESCE(metal, '')) LIKE '%платин%')",
      [r.faceValue],
      r.weightG,
      r.weightOz
    );
    console.log("Pt", r.faceValue, "→", r.weightOz, ":", n);
    total += n;
  }

  for (const r of PALLADIUM_RULES) {
    const n = await update(
      "face_value = ? AND (LOWER(COALESCE(metal, '')) LIKE '%палладий%')",
      [r.faceValue],
      r.weightG,
      r.weightOz
    );
    console.log("Pd", r.faceValue, "→", r.weightOz, ":", n);
    total += n;
  }

  // Исключение: 10 рублей Золотой червонец «Сеятель» 2023 — 7,78 г (1/4 унции)
  const nSeyatel = await update(
    "face_value = '10 рублей' AND (LOWER(COALESCE(metal, '')) LIKE '%золото%') AND (title LIKE '%Золотой червонец%' OR title LIKE '%Сеятель%' OR title LIKE '%сеятель%') AND release_date >= '2023-01-01' AND release_date < '2024-01-01'",
    [],
    "7.78",
    "1/4 унции"
  );
  console.log("10 рублей Золотой червонец 2023 (1/4 унции):", nSeyatel);
  total += nSeyatel;

  await conn.end();
  console.log("Всего обновлено:", total);
  console.log("Дальше: npm run data:export");
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
