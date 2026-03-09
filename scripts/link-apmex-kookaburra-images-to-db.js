/**
 * Привязывает картинки из apmex-kookaburra-parsed.json к монетам Kookaburra в БД.
 * Пути в JSON могут быть apmex-kookaburra/... — при записи в БД подставляется kookaburra/.
 *
 * Не перезаписывает монеты, у которых уже есть image_obverse (foreign, chards, perth).
 *
 * Запуск: node scripts/link-apmex-kookaburra-images-to-db.js
 */

/* eslint-disable no-console */

require("dotenv").config({ path: ".env" });
const fs = require("fs");
const path = require("path");
const mysql = require("mysql2/promise");

const PARSED_PATH = path.join(__dirname, "..", "data", "apmex-kookaburra-parsed.json");

function weightToG(weight) {
  const w = String(weight).toLowerCase();
  if (w === "1oz" || w === "1-oz") return 31.1;
  if (w === "2oz" || w === "2-oz") return 62.2;
  if (w === "10oz" || w === "10-oz") return 311;
  if (w === "1kg" || w === "1-kg") return 1000;
  if (w === "5oz" || w === "5-oz") return 155;
  if (w === "1/10oz" || w === "1-10oz") return 3.11;
  return null;
}

async function main() {
  if (!fs.existsSync(PARSED_PATH)) {
    console.error("Не найден:", PARSED_PATH);
    console.error("Сначала: node scripts/parse-apmex-kookaburra-and-download.js");
    process.exit(1);
  }

  const entries = JSON.parse(fs.readFileSync(PARSED_PATH, "utf8"));
  const withImages = entries.filter((e) => e.obverse && e.reverse);
  console.log("Записей с obv+rev:", withImages.length);

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

  const toForeignPath = (p) => (p || "").replace("/apmex-kookaburra/apmex-kookaburra-", "/foreign/kookaburra-").replace("/apmex-kookaburra/", "/foreign/");
  const verbose = process.argv.includes("--verbose");
  let updated = 0;
  const seen = new Set();
  for (const entry of withImages) {
    const obverse = toForeignPath(entry.obverse);
    const reverse = toForeignPath(entry.reverse);
    const { year, weight } = entry;
    const weightG = weightToG(weight);
    if (!weightG) continue;
    const key = `${year}-${weight}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const [rows] = await conn.execute(
      `SELECT id, title, image_obverse, image_reverse FROM coins
       WHERE (title LIKE '%kookaburra%' OR title LIKE '%кукабарра%' OR title LIKE '%Кукабарра%'
          OR series LIKE '%kookaburra%' OR series LIKE '%Kookaburra%' OR series LIKE '%кукабарра%'
          OR catalog_number LIKE '%kookaburra%' OR catalog_number LIKE '%KOOK%')
         AND (release_date IS NULL OR YEAR(release_date) = ?)
         AND weight_g IS NOT NULL AND weight_g >= ? AND weight_g <= ?
         AND (image_obverse IS NULL OR TRIM(COALESCE(image_obverse, '')) = '')
       LIMIT 50`,
      [year, weightG - 2, weightG + 2]
    );

    if (rows.length === 0) {
      if (verbose) console.log(`  - ${year} ${weight}: нет монет в БД`);
      continue;
    }

    const ids = rows.map((r) => r.id);
    const placeholders = ids.map(() => "?").join(", ");
    const [res] = await conn.execute(
      `UPDATE coins SET image_obverse = ?, image_reverse = ? WHERE id IN (${placeholders})`,
      [obverse, reverse, ...ids]
    );
    if (res.affectedRows > 0) {
      console.log(`  ✓ ${year} ${weight}: ${res.affectedRows} монет`);
      updated += res.affectedRows;
    }
  }

  await conn.end();
  console.log("\nГотово. Обновлено монет:", updated);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
