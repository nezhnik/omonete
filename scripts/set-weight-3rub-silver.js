/**
 * Проставляет вес 1 унция (weight_g = '31.1') всем серебряным монетам с номиналом 3 рубля.
 * После запуска выполнить: npm run data:export — чтобы обновить каталог.
 * Запуск: node scripts/set-weight-3rub-silver.js
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

  const [rows] = await conn.execute(
    `SELECT id, title, face_value, metal FROM coins
     WHERE face_value = '3 рубля' AND (LOWER(COALESCE(metal, '')) LIKE '%серебро%')`
  );
  console.log("Найдено серебряных монет 3 рубля:", rows.length);

  if (rows.length === 0) {
    await conn.end();
    return;
  }

  const [result] = await conn.execute(
    `UPDATE coins SET weight_g = '31.1', weight_oz = '1 унция'
     WHERE face_value = '3 рубля' AND (LOWER(COALESCE(metal, '')) LIKE '%серебро%')`
  ).catch((err) => {
    if (err.code === "ER_BAD_FIELD_ERROR" && /weight_oz/.test(err.message)) {
      return conn.execute(
        `UPDATE coins SET weight_g = '31.1'
         WHERE face_value = '3 рубля' AND (LOWER(COALESCE(metal, '')) LIKE '%серебро%')`
      );
    }
    throw err;
  });
  console.log("Обновлено записей (weight_g + weight_oz):", result.affectedRows);
  await conn.end();
  console.log("Дальше: npm run data:export — затем фильтр «1 унция» покажет эти монеты.");
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
