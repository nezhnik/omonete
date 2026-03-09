/**
 * Убирает ошибочную подстановку картинки "3-coin-set" у всех продуктов, кроме самого набора 2013.
 * 1) В канониках data/perth-mint-*.json (кроме файла 2013 3-coin-set) обнуляем image_obverse/image_reverse если там этот путь.
 * 2) В БД обнуляем image_obverse, image_reverse у монет, у которых путь 3-coin-set, но название не "Three Coin Set".
 *
 * Запуск: node scripts/fix-wrong-3-coin-set-image.js
 *         node scripts/fix-wrong-3-coin-set-image.js --dry
 */
require("dotenv").config({ path: ".env" });
const fs = require("fs");
const path = require("path");
const mysql = require("mysql2/promise");

const DATA_DIR = path.join(__dirname, "..", "data");
const WRONG_PATH = "2013-australian-kookaburra-kangaroo-koala-high-relief-silver-pr-99-9-1-oz-3-coin-set";
const KEEP_FILE = "perth-mint-2013-australian-kookaburra-kangaroo-koala-high-relief-silver-pr-99-9-1-oz-3-coin-set.json";

function getConfig() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL не задан");
  const m = url.match(/mysql:\/\/([^:]+):([^@]+)@([^:]+):(\d+)\/(.+)/);
  if (!m) throw new Error("Неверный формат DATABASE_URL");
  const [, user, password, host, port, database] = m;
  return { host, port: parseInt(port, 10), user, password, database };
}

function hasWrongPath(val) {
  return val && String(val).includes(WRONG_PATH);
}

async function main() {
  const dryRun = process.argv.includes("--dry");
  if (dryRun) console.log("Режим --dry: изменения не применяются.\n");

  let jsonFixed = 0;
  const files = fs.readdirSync(DATA_DIR).filter((f) => f.startsWith("perth-mint-") && f.endsWith(".json") && f !== KEEP_FILE);
  for (const f of files) {
    const filePath = path.join(DATA_DIR, f);
    let raw;
    try {
      raw = JSON.parse(fs.readFileSync(filePath, "utf8"));
    } catch {
      continue;
    }
    const c = raw.coin;
    if (!c) continue;
    let changed = false;
    if (hasWrongPath(c.image_obverse)) {
      c.image_obverse = null;
      changed = true;
    }
    if (hasWrongPath(c.image_reverse)) {
      c.image_reverse = null;
      changed = true;
    }
    if (raw.saved) {
      if (hasWrongPath(raw.saved.obverse)) {
        raw.saved.obverse = null;
        changed = true;
      }
      if (hasWrongPath(raw.saved.reverse)) {
        raw.saved.reverse = null;
        changed = true;
      }
    }
    if (changed) {
      jsonFixed++;
      if (!dryRun) fs.writeFileSync(filePath, JSON.stringify(raw, null, 2));
      console.log("  canonical:", f);
    }
  }
  console.log("Каноников исправлено (очищен путь 3-coin-set):", jsonFixed);

  const conn = await mysql.createConnection(getConfig());
  const [rows] = await conn.execute(
    `SELECT id, title, image_obverse, image_reverse, image_urls FROM coins
     WHERE (image_obverse LIKE ? OR image_reverse LIKE ? OR image_urls LIKE ?)
     AND title NOT LIKE '%Three Coin Set%'
     AND title NOT LIKE '%3 Coin Set%'
     AND title NOT LIKE '%3-coin-set%'`,
    ["%" + WRONG_PATH + "%", "%" + WRONG_PATH + "%", "%" + WRONG_PATH + "%"]
  );
  console.log("Записей в БД с чужой картинкой 3-coin-set:", rows.length);

  if (rows.length > 0 && !dryRun) {
    const ids = rows.map((r) => r.id);
    const placeholders = ids.map(() => "?").join(",");
    await conn.execute(
      `UPDATE coins SET image_obverse = NULL, image_reverse = NULL, image_urls = NULL WHERE id IN (${placeholders})`,
      ids
    );
    console.log("В БД обнулены image_obverse, image_reverse, image_urls у id:", ids.slice(0, 10).join(", ") + (ids.length > 10 ? " ..." : ""));
  }
  await conn.end();

  console.log("\nГотово. Дальше: node scripts/export-coins-to-json.js (без --incremental) и npm run build.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
