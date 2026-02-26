/**
 * Исключение: монета 5215-0006 «100 лет Транссибирской магистрали».
 * По ЦБР: содержание чистого металла 3,89 г, в унциях — 1/8.
 * Было ошибочно: 3,11 г и 1/10 унции.
 * После запуска: npm run data:export (или npm run build).
 * Запуск: node scripts/fix-weight-5215-0006.js
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

  const [result] = await conn
    .execute(
      `UPDATE coins SET weight_g = '3.89', weight_oz = '1/8 унции' WHERE catalog_number = '5215-0006'`
    )
    .catch((err) => {
      if (err.code === "ER_BAD_FIELD_ERROR" && /weight_oz/.test(err.message)) {
        return conn.execute(
          `UPDATE coins SET weight_g = '3.89' WHERE catalog_number = '5215-0006'`
        );
      }
      throw err;
    });

  console.log("Обновлено записей:", result.affectedRows);
  if (result.affectedRows === 0) {
    console.warn("Монета с catalog_number=5215-0006 не найдена в БД.");
  } else {
    console.log("5215-0006: вес 3,89 г, 1/8 унции. Дальше: npm run data:export");
  }
  await conn.end();
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
