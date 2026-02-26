require("dotenv").config({ path: ".env" });
const mysql = require("mysql2/promise");

async function test() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL не задан в .env");
    process.exit(1);
  }

  // Парсим mysql://user:pass@host:port/db
  const m = url.match(/mysql:\/\/([^:]+):([^@]+)@([^:]+):(\d+)\/(.+)/);
  if (!m) {
    console.error("Неверный формат DATABASE_URL");
    process.exit(1);
  }
  const [, user, password, host, port, database] = m;

  try {
    const conn = await mysql.createConnection({
      host,
      port: parseInt(port, 10),
      user,
      password,
      database,
    });
    const [rows] = await conn.execute("SELECT 1 as ok, DATABASE() as db");
    console.log("✓ Подключение успешно:", rows[0]);
    await conn.end();
  } catch (err) {
    console.error("✗ Ошибка подключения:", err.message);
    process.exit(1);
  }
}

test();
