/**
 * Проверка состояния монет Australian Kookaburra в БД.
 * Поля: face_value, metal_fineness, mintage, weight_g, weight_oz, diameter_mm, thickness_mm
 *
 * Запуск: node scripts/check-kookaburra-db-state.js
 */

require("dotenv").config({ path: ".env" });
const mysql = require("mysql2/promise");

async function main() {
  const url = process.env.DATABASE_URL;
  const m = url.match(/mysql:\/\/([^:]+):([^@]+)@([^:]+):(\d+)\/(.+)/);
  const conn = await mysql.createConnection({
    host: m[3], port: parseInt(m[4], 10), user: m[1], password: m[2], database: m[5],
  });

  const [rows] = await conn.execute(
    `SELECT id, catalog_number, catalog_suffix, face_value, metal_fineness, mintage,
            weight_g, weight_oz, diameter_mm, thickness_mm
     FROM coins
     WHERE series = 'Australian Kookaburra' AND catalog_number LIKE 'AU-KOOK-%'
     ORDER BY catalog_number, catalog_suffix`
  );

  console.log("Всего записей Australian Kookaburra (AU-KOOK):", rows.length);
  console.log("");

  const fields = ["face_value", "metal_fineness", "mintage", "weight_g", "weight_oz", "diameter_mm", "thickness_mm"];
  for (const f of fields) {
    const nullOrEmpty = rows.filter((r) => r[f] == null || String(r[f]).trim() === "");
    console.log(`${f}: заполнено ${rows.length - nullOrEmpty.length}/${rows.length}, пусто/NULL: ${nullOrEmpty.length}`);
  }

  console.log("\n--- Примеры с пустыми diameter_mm или thickness_mm ---");
  const needsDiam = rows.filter((r) => r.diameter_mm == null || String(r.diameter_mm).trim() === "");
  const needsThick = rows.filter((r) => r.thickness_mm == null || String(r.thickness_mm).trim() === "");
  const needsEither = [...new Map(needsDiam.concat(needsThick).map((r) => [r.id, r])).values()];
  needsEither.slice(0, 15).forEach((r) => {
    console.log(`  id=${r.id} ${r.catalog_number}${r.catalog_suffix ? "-" + r.catalog_suffix : ""} diam=${r.diameter_mm ?? "NULL"} thick=${r.thickness_mm ?? "NULL"}`);
  });
  if (needsEither.length > 15) console.log(`  ... и еще ${needsEither.length - 15}`);

  await conn.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
