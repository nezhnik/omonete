/**
 * Проставляет source_url в БД для уже загруженных Perth-монет из data/perth-mint-fetch-progress.json.
 * Запуск: node scripts/backfill-source-url-from-progress.js
 */
require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });
const mysql = require("mysql2/promise");
const fs = require("fs");
const path = require("path");

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL не задан");
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

  const progressPath = path.join(__dirname, "..", "data", "perth-mint-fetch-progress.json");
  if (!fs.existsSync(progressPath)) {
    console.log("Нет файла perth-mint-fetch-progress.json");
    await conn.end();
    return;
  }
  const progress = JSON.parse(fs.readFileSync(progressPath, "utf8"));
  const coins = progress.coins || [];
  let updated = 0;
  for (const entry of coins) {
    const sourceUrl = (entry.url || "").trim();
    const catalogNumber = (entry.catalog_number || "").trim();
    if (!sourceUrl || !catalogNumber) continue;
    const [res] = await conn.execute(
      "UPDATE coins SET source_url = ? WHERE catalog_number = ?",
      [sourceUrl, catalogNumber]
    );
    if (res.affectedRows > 0) {
      updated += res.affectedRows;
      console.log("  ", catalogNumber, "→ source_url");
    }
  }
  await conn.end();
  console.log("✓ Проставлено source_url для", updated, "монет");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
