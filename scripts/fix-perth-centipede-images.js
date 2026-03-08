/**
 * Ставит сколопендре правильные аверс/реверс (perth-centipede-2026-obv/rev.webp),
 * одну картинку коробки; убирает дубли коробки. Запуск: node scripts/fix-perth-centipede-images.js
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
  const obv = "/image/coins/foreign/perth-centipede-2026-obv.webp";
  const rev = "/image/coins/foreign/perth-centipede-2026-rev.webp";
  const box = "/image/coins/foreign/giant-centipede-2026-1oz-silver-proof-co-2026-box.webp";

  const [res] = await conn.execute(
    `UPDATE coins SET image_obverse = ?, image_reverse = ?, image_box = ?, image_certificate = NULL, release_date = '2026'
     WHERE catalog_number = 'AU-PERTH-2026-26Y15AAA'`,
    [obv, rev, box]
  );
  console.log("Обновлено записей:", res.affectedRows);
  if (res.affectedRows) console.log("  аверс:", obv, "\n  реверс:", rev, "\n  коробка:", box, "\n  release_date: 2026");
  await conn.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
