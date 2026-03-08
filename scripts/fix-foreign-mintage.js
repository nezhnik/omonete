/**
 * Округляет тиражи иностранных монет до тысяч (287 178 → 287 000, 287 877 → 288 000).
 * mintage_display очищается — используется округлённый mintage.
 *
 * Запуск: node scripts/fix-foreign-mintage.js
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

  const [rows] = await conn.execute(
    `SELECT id, title, mintage, mintage_display, country, catalog_number
     FROM coins
     WHERE country != 'Россия' AND country IS NOT NULL AND mintage IS NOT NULL
     AND (catalog_number NOT LIKE 'US-ASE-%' OR catalog_number IS NULL)`
  );

  let updated = 0;
  for (const r of rows) {
    const rounded = Math.round(r.mintage / 1000) * 1000;
    if (rounded === r.mintage && !r.mintage_display) continue;

    await conn.execute(
      `UPDATE coins SET mintage = ?, mintage_display = NULL WHERE id = ?`,
      [rounded, r.id]
    );
    updated++;
    if (r.mintage !== rounded) {
      console.log(`  ${r.id}: ${r.mintage} → ${rounded} (${r.title?.slice(0, 40)}...)`);
    }
  }

  await conn.end();
  console.log("✓ Округлено тиражей иностранных монет:", updated);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
