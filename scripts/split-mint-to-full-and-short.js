/**
 * Разбивает mint на полное (без скобок) и короткое (только аббревиатуры).
 * mint: "Московский монетный двор (ММД)" → mint: "Московский монетный двор", mint_short: "ММД"
 * mint: "Московский монетный двор (ММД), Ленинградский монетный двор (ЛМД)" → mint: "Московский монетный двор, Ленинградский монетный двор", mint_short: "ММД, ЛМД"
 * Запуск: node scripts/split-mint-to-full-and-short.js
 */
require("dotenv").config({ path: ".env" });
const mysql = require("mysql2/promise");

function splitMint(mint) {
  if (!mint || typeof mint !== "string") return { full: null, short: null };
  const trimmed = mint.trim();
  if (!trimmed || trimmed === "—") return { full: null, short: null };
  const shortMatches = [...trimmed.matchAll(/\(([А-Яа-я,\sи]+)\)/g)];
  const shortParts = shortMatches.map((m) => m[1].replace(/\s+/g, " ").trim());
  const short = shortParts.length > 0 ? shortParts.join(", ") : null;
  const full = trimmed.replace(/\s*\([А-Яа-я,\sи]+\)/g, "").replace(/\s+/g, " ").trim() || null;
  return { full, short };
}

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
  const conn = await mysql.createConnection({
    host,
    port: parseInt(port, 10),
    user,
    password,
    database,
  });

  const [cols] = await conn.execute(
    `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS 
     WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'coins' AND COLUMN_NAME = 'mint_short'`,
    [database]
  );
  if (cols.length === 0) {
    await conn.execute(`ALTER TABLE coins ADD COLUMN mint_short VARCHAR(100) DEFAULT NULL COMMENT 'Короткое наименование МД' AFTER mint`);
    console.log("✓ Добавлена колонка mint_short");
  }

  const [rows] = await conn.execute(
    `SELECT id, catalog_number, mint FROM coins WHERE mint IS NOT NULL AND TRIM(mint) != '' AND mint != '—'`
  );
  let updated = 0;
  for (const row of rows) {
    const { full, short } = splitMint(row.mint);
    if (full !== row.mint || short) {
      await conn.execute("UPDATE coins SET mint = ?, mint_short = ? WHERE id = ?", [full, short, row.id]);
      updated++;
      if (updated <= 5) {
        console.log("  ", row.catalog_number, "| mint:", row.mint?.slice(0, 50), "→ full:", full?.slice(0, 40), "| short:", short);
      }
    }
  }
  console.log("Готово. Обновлено:", updated, "из", rows.length);
  await conn.end();
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
