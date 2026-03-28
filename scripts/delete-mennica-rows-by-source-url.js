/**
 * Удаление строк coins по source_url (исключённые из каталога позиции Mennica).
 *
 *   node scripts/delete-mennica-rows-by-source-url.js
 *   node scripts/delete-mennica-rows-by-source-url.js --dry-run
 */
require("dotenv").config({ path: ".env" });
const mysql = require("mysql2/promise");
const { RAW_EXCLUDED } = require("./mennica-excluded-product-urls.js");

const EXCLUDED_SOURCE_URLS = RAW_EXCLUDED;

function normalizeUrl(url) {
  if (!url || typeof url !== "string") return null;
  try {
    const u = new URL(url.trim());
    u.hash = "";
    u.search = "";
    return u.toString().replace(/\/+$/, "");
  } catch {
    return String(url).trim().replace(/\/+$/, "") || null;
  }
}

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
  const variants = new Set();
  for (const raw of EXCLUDED_SOURCE_URLS) {
    const n = normalizeUrl(raw);
    if (n) {
      variants.add(n);
      variants.add(`${n}/`);
    }
  }
  const list = [...variants];
  const conn = await mysql.createConnection(getConfig());
  try {
    const ph = list.map(() => "?").join(", ");
    const [rows] = await conn.execute(
      `SELECT id, catalog_number, source_url, title FROM coins WHERE source_url IN (${ph})`,
      list
    );
    console.log("Найдено строк:", rows.length);
    for (const r of rows) {
      console.log(`  id=${r.id} catalog_number=${r.catalog_number} ${r.source_url}`);
    }
    if (dry) {
      console.log("--dry-run: DELETE не выполнялся");
      return;
    }
    if (rows.length === 0) {
      console.log("Нечего удалять.");
      return;
    }
    const [res] = await conn.execute(`DELETE FROM coins WHERE source_url IN (${ph})`, list);
    console.log("Удалено строк:", res.affectedRows);
  } finally {
    await conn.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
