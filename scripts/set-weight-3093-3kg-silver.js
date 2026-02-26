/**
 * Проставляет вес 3 кг (weight_g = 3000, weight_oz = '3 кг') монете id=3093
 * «300-летие Санкт-Петербургского монетного двора», 200 рублей, серебро.
 * После запуска: npm run data:export (или npm run build).
 * Запуск: node scripts/set-weight-3093-3kg-silver.js
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
      `UPDATE coins SET weight_g = '3000', weight_oz = '3 кг' WHERE id = 3093`
    )
    .catch((err) => {
      if (err.code === "ER_BAD_FIELD_ERROR" && /weight_oz/.test(err.message)) {
        return conn.execute(
          `UPDATE coins SET weight_g = '3000' WHERE id = 3093`
        );
      }
      throw err;
    });

  console.log("Обновлено записей:", result.affectedRows);
  if (result.affectedRows === 0) {
    console.warn("Монета с id=3093 не найдена в БД.");
  } else {
    console.log("Монета 3093: вес установлен 3 кг (3000 г). Дальше: npm run data:export");
  }
  await conn.end();
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
