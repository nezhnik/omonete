/**
 * Один раз добавляет столбец source_url в coins.
 * Запуск: node scripts/run-add-source-url.js
 */
require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });
const mysql = require("mysql2/promise");
const fs = require("fs");
const path = require("path");

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL не задан");
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
  const sqlPath = path.join(__dirname, "add-source-url-column.sql");
  let sql = fs.readFileSync(sqlPath, "utf8");
  sql = sql.replace(/^--.*\n/gm, "").trim();
  try {
    await conn.execute(sql);
    console.log("✓ Столбец source_url добавлен в coins");
  } catch (e) {
    if (e.code === "ER_DUP_FIELDNAME") {
      console.log("Столбец source_url уже есть, ничего не делаем");
    } else throw e;
  }
  await conn.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
