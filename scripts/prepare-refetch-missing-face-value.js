/**
 * Выгружает source_url монет Perth с пустым номиналом в perth-mint-refetch-urls.txt.
 * Дальше: node scripts/fetch-perth-mint-coin.js --refetch-lost --refresh
 * затем: node scripts/import-perth-mint-to-db.js
 */
require("dotenv").config({ path: ".env" });
const fs = require("fs");
const path = require("path");
const mysql = require("mysql2/promise");

const REFETCH_FILE = path.join(__dirname, "perth-mint-refetch-urls.txt");

function getConfig() {
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
  return { host, port: parseInt(port, 10), user, password, database };
}

async function main() {
  const conn = await mysql.createConnection(getConfig());
  const [rows] = await conn.execute(
    `SELECT id, source_url, title FROM coins
     WHERE (mint LIKE '%Perth%' OR mint_short LIKE '%Perth%')
     AND (face_value IS NULL OR TRIM(face_value) = '')
     AND source_url IS NOT NULL AND TRIM(source_url) != ''
     ORDER BY id`
  );
  await conn.end();
  const urls = rows.map((r) => (r.source_url || "").trim()).filter(Boolean);
  if (urls.length === 0) {
    console.log("Нет записей Perth с пустым номиналом и заполненным source_url.");
    return;
  }
  fs.writeFileSync(REFETCH_FILE, urls.join("\n") + "\n", "utf8");
  console.log("Записано URL в", REFETCH_FILE, ":", urls.length);
  console.log("Дальше выполни:");
  console.log("  node scripts/fetch-perth-mint-coin.js --refetch-lost --refresh");
  console.log("  node scripts/import-perth-mint-to-db.js");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
