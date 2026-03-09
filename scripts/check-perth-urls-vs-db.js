/**
 * Проверка: все ли URL из perth-mint-urls.txt есть в БД.
 * Недостающие пишет в perth-mint-missing-in-db.txt.
 *
 *   node scripts/check-perth-urls-vs-db.js           — только проверка
 *   node scripts/check-perth-urls-vs-db.js --write    — записать недостающие в файл
 */
require("dotenv").config({ path: ".env" });
const mysql = require("mysql2/promise");
const fs = require("fs");
const path = require("path");

const URL_LIST_FILE = path.join(__dirname, "perth-mint-urls.txt");
const MISSING_FILE = path.join(__dirname, "perth-mint-missing-in-db.txt");

function normUrl(u) {
  if (!u || typeof u !== "string") return null;
  return u.trim().replace(/\/+$/, "") || null;
}

function getConfig() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL не задан в .env");
  const m = url.match(/mysql:\/\/([^:]+):([^@]+)@([^:]+):(\d+)\/(.+)/);
  if (!m) throw new Error("Неверный формат DATABASE_URL");
  const [, user, password, host, port, database] = m;
  return { host, port: parseInt(port, 10), user, password, database };
}

async function main() {
  const doWrite = process.argv.includes("--write");

  const text = fs.readFileSync(URL_LIST_FILE, "utf8");
  const urlList = text
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter((s) => s && s.startsWith("http"));
  const urlSet = new Set(urlList.map(normUrl).filter(Boolean));
  console.log("URL в perth-mint-urls.txt:", urlSet.size);

  const conn = await mysql.createConnection(getConfig());
  const [rows] = await conn.execute(
    `SELECT source_url FROM coins
     WHERE source_url IS NOT NULL AND source_url LIKE '%perthmint.com%'`
  );
  await conn.end();

  const dbUrls = new Set(rows.map((r) => normUrl(r.source_url)).filter(Boolean));
  console.log("Уникальных source_url (Perth) в БД:", dbUrls.size);

  const missing = [];
  for (const norm of urlSet) {
    if (!dbUrls.has(norm)) {
      const full = urlList.find((u) => normUrl(u) === norm) || norm;
      missing.push(full.endsWith("/") ? full : full + "/");
    }
  }

  console.log("Недостающих (есть в списке, нет в БД):", missing.length);
  if (missing.length === 0) {
    console.log("\nВсё есть в БД.");
    return;
  }

  if (doWrite && missing.length > 0) {
    fs.writeFileSync(MISSING_FILE, missing.join("\n") + "\n", "utf8");
    console.log("\nЗаписано в", path.basename(MISSING_FILE));
    console.log("Дальше: node scripts/fetch-perth-mint-coin.js --missing");
    console.log("Затем: node scripts/import-perth-mint-to-db.js --all-by-source-url");
  } else {
    console.log("\nПервые 10 недостающих:");
    missing.slice(0, 10).forEach((u) => console.log(" ", u.slice(-70)));
    if (missing.length > 10) console.log("  ... и ещё", missing.length - 10);
    console.log("\nЧтобы записать в файл: node scripts/check-perth-urls-vs-db.js --write");
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
