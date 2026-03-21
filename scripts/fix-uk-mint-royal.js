/**
 * Для всех монет со страной Великобритания (и United Kingdom) выставляет
 * mint = The Royal Mint, mint_short = Royal Mint.
 *
 * Запуск: node scripts/fix-uk-mint-royal.js
 * Требуется DATABASE_URL в .env
 */

require("dotenv").config({ path: ".env" });
const mysql = require("mysql2/promise");

function parseDatabaseUrl(url) {
  const m = url.match(/mysql:\/\/([^:]+):([^@]+)@([^:]+):(\d+)\/(.+)/);
  if (!m) throw new Error("Неверный формат DATABASE_URL");
  const [, user, password, host, port, database] = m;
  return { user, password, host, port: parseInt(port, 10), database };
}

async function run() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL не задан в .env");
    process.exit(1);
  }
  const conn = await mysql.createConnection(parseDatabaseUrl(url));

  try {
    const [before] = await conn.execute(
      `
      SELECT id, title, mint, mint_short, country
      FROM coins
      WHERE country = "Великобритания" OR country = "United Kingdom"
      ORDER BY id
      `
    );
    const rows = before;
    if (!rows.length) {
      console.log("Монет с country = Великобритания / United Kingdom не найдено.");
      return;
    }

    const needFix = rows.filter(
      (r) =>
        (r.mint || "").trim() !== "The Royal Mint" ||
        (r.mint_short || "").trim() !== "Royal Mint"
    );

    console.log(`Всего монет UK в БД: ${rows.length}`);
    console.log(`Из них с другим mint / mint_short (будут обновлены): ${needFix.length}`);
    if (needFix.length && needFix.length <= 30) {
      needFix.forEach((r) => {
        console.log(`  id=${r.id} mint="${r.mint}" mint_short="${r.mint_short}" — ${String(r.title || "").slice(0, 60)}…`);
      });
    } else if (needFix.length > 30) {
      needFix.slice(0, 15).forEach((r) => {
        console.log(`  id=${r.id} mint="${r.mint}" mint_short="${r.mint_short}"`);
      });
      console.log(`  … и ещё ${needFix.length - 15} строк`);
    }

    const [res] = await conn.execute(
      `
      UPDATE coins
      SET mint = "The Royal Mint", mint_short = "Royal Mint"
      WHERE country = "Великобритания" OR country = "United Kingdom"
      `
    );
    console.log(`✓ UPDATE: затронуто строк (affectedRows): ${res.affectedRows ?? 0}`);
    console.log("Дальше: npm run data:export:incremental (или полный export) и при необходимости build.");
  } finally {
    await conn.end();
  }
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
