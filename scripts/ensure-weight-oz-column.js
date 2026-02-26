/**
 * Добавляет колонку weight_oz в таблицу coins, если её ещё нет.
 * Запуск: node scripts/ensure-weight-oz-column.js
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

  try {
    await conn.execute(
      `ALTER TABLE coins
       ADD COLUMN weight_oz VARCHAR(50) DEFAULT NULL COMMENT 'Вес в унциях/кг (1 унция, 1/2 унции, 1 кг …)' AFTER weight_g`
    );
    console.log("Колонка weight_oz добавлена.");
  } catch (err) {
    if (err.code === "ER_DUP_FIELD_NAME") {
      console.log("Колонка weight_oz уже есть.");
    } else {
      throw err;
    }
  }
  await conn.end();
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
