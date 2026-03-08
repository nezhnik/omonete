/**
 * Исправляет массу чистого металла для ASE: 31,1035 → 31,1 (как у российских монет).
 * Запуск: node scripts/fix-ase-weight.js
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

  const [result] = await conn.execute(
    `UPDATE coins SET weight_g = '31,1'
     WHERE country != 'Россия' AND weight_oz = '1 унция'
     AND (weight_g LIKE '31,1035%' OR weight_g LIKE '31.1035%')`
  );

  await conn.end();
  console.log("✓ Обновлено монет:", result.affectedRows);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
