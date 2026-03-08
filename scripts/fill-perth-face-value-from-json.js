/**
 * Подтягивание face_value из data/perth-mint-*.json в БД для записей Perth с пустым номиналом.
 * Совпадение по source_url или по catalog_number (Perth).
 *
 * Запуск:
 *   node scripts/fill-perth-face-value-from-json.js       — показать, что будет обновлено
 *   node scripts/fill-perth-face-value-from-json.js --do — выполнить UPDATE
 */
require("dotenv").config({ path: ".env" });
const fs = require("fs");
const path = require("path");
const mysql = require("mysql2/promise");

const DATA_DIR = path.join(__dirname, "..", "data");

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

function loadJsonByCatalogAndUrl() {
  const files = fs.readdirSync(DATA_DIR)
    .filter((f) => f.startsWith("perth-mint-") && f.endsWith(".json") && f !== "perth-mint-fetch-progress.json" && f !== "perth-mint-image-url-cache.json");
  const byUrl = new Map();
  const byCatalog = new Map();
  for (const f of files) {
    try {
      const data = JSON.parse(fs.readFileSync(path.join(DATA_DIR, f), "utf8"));
      const c = data.coin;
      if (!c || !(c.face_value && String(c.face_value).trim())) continue;
      const fv = String(c.face_value).trim();
      const url = (c.source_url && String(c.source_url).trim()) || null;
      const catalog = (c.catalog_number && String(c.catalog_number).trim()) || null;
      if (url) byUrl.set(url, fv);
      if (catalog) byCatalog.set(catalog, fv);
    } catch (e) {
      // skip
    }
  }
  return { byUrl, byCatalog };
}

async function main() {
  const doUpdate = process.argv.includes("--do");
  const { byUrl, byCatalog } = loadJsonByCatalogAndUrl();
  const conn = await mysql.createConnection(getConfig());
  const [rows] = await conn.execute(
    `SELECT id, title, catalog_number, source_url, face_value FROM coins
     WHERE (mint LIKE '%Perth%' OR mint_short LIKE '%Perth%')
     AND (face_value IS NULL OR TRIM(face_value) = '')
     ORDER BY id`
  );
  const updates = [];
  for (const r of rows) {
    const fv = (r.source_url && byUrl.get(r.source_url.trim())) || (r.catalog_number && byCatalog.get(r.catalog_number.trim()));
    if (fv) updates.push({ id: r.id, title: r.title, face_value: fv });
  }
  if (updates.length === 0) {
    console.log("Нет записей Perth с пустым номиналом, для которых есть значение в JSON.");
    await conn.end();
    return;
  }
  console.log("Будет обновлено номиналов:", updates.length);
  updates.slice(0, 20).forEach((u) => console.log("  id=" + u.id, (u.title || "").substring(0, 45), "→", u.face_value));
  if (updates.length > 20) console.log("  ... и ещё", updates.length - 20);
  if (!doUpdate) {
    console.log("\nДля применения: node scripts/fill-perth-face-value-from-json.js --do");
    await conn.end();
    return;
  }
  let n = 0;
  for (const u of updates) {
    await conn.execute("UPDATE coins SET face_value = ? WHERE id = ?", [u.face_value, u.id]);
    n++;
  }
  console.log("\nОбновлено записей:", n);
  await conn.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
