require("dotenv").config({ path: ".env" });
const mysql = require("mysql2/promise");
const fs = require("fs");
const path = require("path");

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

  const sqlPath = process.argv[2] || path.join(__dirname, "create-coins-table.sql");
  const sql = fs.readFileSync(sqlPath, "utf8");

  try {
    const conn = await mysql.createConnection({
      host,
      port: parseInt(port, 10),
      user,
      password,
      database,
      multipleStatements: true,
    });
    await conn.query(sql);
    console.log("✓ SQL выполнен:", sqlPath);
    await conn.end();
  } catch (err) {
    console.error("✗ Ошибка:", err.message);
    process.exit(1);
  }
}

run();
