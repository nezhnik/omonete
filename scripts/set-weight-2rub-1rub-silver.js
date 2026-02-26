/**
 * Серебряные 2 рубля → 1/2 унции (15,55 г), серебряные 1 рубль → 1/4 унции (7,78 г).
 * После запуска: npm run data:export
 * Запуск: node scripts/set-weight-2rub-1rub-silver.js
 */
require("dotenv").config({ path: ".env" });
const mysql = require("mysql2/promise");

async function run() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL не задан в .env");
    process.exit(1);
  }
  const conn = await mysql.createConnection(url);

  const update = async (faceValue, weightG, weightOz) => {
    const [count] = await conn.execute(
      `SELECT COUNT(*) as n FROM coins
       WHERE face_value = ? AND (LOWER(COALESCE(metal, '')) LIKE '%серебро%')`,
      [faceValue]
    );
    const n = count[0]?.n ?? 0;
    if (n === 0) return 0;
    const [result] = await conn
      .execute(
        `UPDATE coins SET weight_g = ?, weight_oz = ?
         WHERE face_value = ? AND (LOWER(COALESCE(metal, '')) LIKE '%серебро%')`,
        [weightG, weightOz, faceValue]
      )
      .catch((err) => {
        if (err.code === "ER_BAD_FIELD_ERROR" && /weight_oz/.test(err.message)) {
          return conn.execute(
            `UPDATE coins SET weight_g = ? WHERE face_value = ? AND (LOWER(COALESCE(metal, '')) LIKE '%серебро%')`,
            [weightG, faceValue]
          );
        }
        throw err;
      });
    return result.affectedRows;
  };

  const r2 = await update("2 рубля", "15.55", "1/2 унции");
  const r1 = await update("1 рубль", "7.78", "1/4 унции");

  console.log("2 рубля (1/2 унции): обновлено", r2);
  console.log("1 рубль (1/4 унции): обновлено", r1);
  await conn.end();
  console.log("Дальше: npm run data:export");
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
