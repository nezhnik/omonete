/**
 * Исправление данных монеты 4192 (Australian Koala 2025 1/2oz Gold): металл золото, вес 1/2 oz.
 * Запуск: node scripts/fix-coin-4192.js
 * После: npm run data:export
 */
require("dotenv").config({ path: ".env" });
const mysql = require("mysql2/promise");

function getConfig() {
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
  return { host, port: parseInt(port, 10), user, password, database };
}

async function main() {
  const conn = await mysql.createConnection(getConfig());
  try {
    const [res] = await conn.execute(
      "UPDATE coins SET metal = ?, weight_g = ?, weight_oz = ?, quality = ?, release_date = ? WHERE id = 4192",
      ["Золото", "15.55", "1/2", "Proof", "2025"]
    );
    if (res.affectedRows === 0) {
      console.log("Монета с id 4192 не найдена в БД.");
      return;
    }
    console.log("✓ Монета 4192 обновлена: металл Золото, вес 15.55 г (1/2 oz), качество Proof, год 2025.");
    console.log("Дальше: npm run data:export");
  } finally {
    await conn.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
