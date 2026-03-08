/**
 * Проставляет release_date для иностранных и Perth-монет из года в названии,
 * если release_date пустой. Тогда год корректно отображается на сайте.
 *
 * Запуск: node scripts/update-release-date-from-title.js
 * После: npm run data:export
 */
require("dotenv").config({ path: ".env" });
const mysql = require("mysql2/promise");
const { yearFromTitle } = require("./format-coin-characteristics.js");

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
    `SELECT id, title, title_en, release_date, mint, country FROM coins
     WHERE (mint LIKE '%Perth%' OR country != 'Россия' OR country IS NULL)
       AND (release_date IS NULL OR release_date = '' OR TRIM(release_date) = '')`
  );
  let updated = 0;
  for (const r of rows) {
    const year = yearFromTitle(r.title) ?? yearFromTitle(r.title_en);
    if (year == null || year < 1900 || year > 2100) continue;
    const releaseDate = `${year}-01-01`;
    await conn.execute(`UPDATE coins SET release_date = ? WHERE id = ?`, [releaseDate, r.id]);
    updated++;
    console.log("  id", r.id, "| release_date →", releaseDate, "|", (r.title || r.title_en || "").slice(0, 50));
  }
  await conn.end();
  console.log("\n✓ Обновлено записей:", updated, "из", rows.length, "без даты");
  if (updated > 0) console.log("Дальше: npm run data:export");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
