/**
 * Проверяет, у каких базовых каталожных номеров нет обоих изображений (аверс и реверс).
 * Это монеты, по которым загрузка ранее завершилась с ошибкой.
 * Запуск: node scripts/check-missing-coin-images.js
 */
require("dotenv").config({ path: ".env" });
const mysql = require("mysql2/promise");
const fs = require("fs");
const path = require("path");

const OUT_DIR = path.join(__dirname, "..", "public", "image", "coins");
const MIN_VALID_SIZE = 1000;

function catalogToBase(cat) {
  if (!cat || typeof cat !== "string") return cat;
  return cat.trim().replace(/-(\d{1,2})$/, "");
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

  const [rows] = await conn.execute(
    `SELECT catalog_number FROM coins WHERE catalog_number IS NOT NULL AND catalog_number != ''`
  );
  const bases = [...new Set(rows.map((r) => catalogToBase(r.catalog_number)))].sort();

  const missing = [];
  for (const base of bases) {
    const op = path.join(OUT_DIR, base + ".webp");
    const rp = path.join(OUT_DIR, base + "r.webp");
    const ob = fs.existsSync(op) && fs.statSync(op).size >= MIN_VALID_SIZE;
    const rb = fs.existsSync(rp) && fs.statSync(rp).size >= MIN_VALID_SIZE;
    if (!ob || !rb) {
      const coinsWithBase = rows.filter((r) => catalogToBase(r.catalog_number) === base);
      missing.push({
        base,
        obverse: ob ? "есть" : "нет",
        reverse: rb ? "есть" : "нет",
        coins: coinsWithBase.length,
        catalog_numbers: coinsWithBase.map((r) => r.catalog_number).slice(0, 5),
      });
    }
  }

  await conn.end();

  if (missing.length === 0) {
    console.log("Все базы имеют оба изображения. Ошибок нет.");
    return;
  }
  const CBR_LEGACY = "https://www.cbr.ru/legacy/PhotoStore/img";
  const CBR_DZI = "https://www.cbr.ru/dzi/";
  console.log("Баз без обоих изображений:", missing.length, "\n");
  missing.forEach((m) => {
    const obverseUrl = `${CBR_LEGACY}/${m.base}r.jpg`;
    const reverseUrl = `${CBR_LEGACY}/${m.base}.jpg`;
    const dziUrl = `${CBR_DZI}?tilesources=${m.base}`;
    console.log(m.base, "| аверс:", m.obverse, "| реверс:", m.reverse, "| монет в БД:", m.coins);
    if (m.catalog_numbers.length) console.log("  катал. номера:", m.catalog_numbers.join(", "));
    console.log("  аверс (ЦБ):", obverseUrl);
    console.log("  реверс (ЦБ):", reverseUrl);
    console.log("  DZI (ЦБ):", dziUrl);
    console.log("");
  });
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
