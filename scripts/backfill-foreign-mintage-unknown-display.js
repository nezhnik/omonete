/**
 * Разово: у иностранных монет без числового тиража и пустого mintage_display
 * выставить «Тираж не указан», чтобы они не пропадали из каталога и помечались для ручного поиска.
 *
 *   npm run data:backfill:mintage-unknown-display
 *   node scripts/backfill-foreign-mintage-unknown-display.js --dry-run
 */
require("dotenv").config({ path: ".env" });
const mysql = require("mysql2/promise");
const { MINTAGE_UNKNOWN_DISPLAY } = require("./parsing-mintage-constants.js");

function getConfig() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL не задан");
  const m = url.match(/mysql:\/\/([^:]+):([^@]+)@([^:]+):(\d+)\/(.+)/);
  if (!m) throw new Error("Неверный формат DATABASE_URL");
  const [, user, password, host, port, database] = m;
  return { host, port: Number(port), user, password, database };
}

async function main() {
  const dry = process.argv.includes("--dry-run");
  const conn = await mysql.createConnection(getConfig());
  const [rows] = await conn.execute(
    `SELECT id, title, country, mintage, mintage_display FROM coins
     WHERE country IS NOT NULL AND TRIM(country) != '' AND country NOT LIKE 'Россия%'
       AND (mintage IS NULL OR mintage = 0)
       AND (mintage_display IS NULL OR TRIM(mintage_display) = '')`
  );
  console.log(dry ? "[dry-run] строк для обновления:" : "Обновляем строк:", rows.length);
  if (rows.length && dry) {
    rows.slice(0, 15).forEach((r) => console.log(`  id=${r.id} ${r.country} ${String(r.title).slice(0, 60)}`));
    if (rows.length > 15) console.log(`  … и ещё ${rows.length - 15}`);
  }
  if (!dry && rows.length) {
    const [res] = await conn.execute(
      `UPDATE coins SET mintage_display = ?
       WHERE country IS NOT NULL AND TRIM(country) != '' AND country NOT LIKE 'Россия%'
         AND (mintage IS NULL OR mintage = 0)
         AND (mintage_display IS NULL OR TRIM(mintage_display) = '')`,
      [MINTAGE_UNKNOWN_DISPLAY]
    );
    console.log("UPDATE affectedRows:", res.affectedRows);
  }
  await conn.end();
  if (!dry && rows.length) console.log("Дальше: npm run data:export:incremental");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
