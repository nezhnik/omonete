/**
 * Сравнение данных Perth: JSON в data/ и записи в БД.
 * Запуск: node scripts/validate-perth-data.js
 *
 * Отчёт:
 * - JSON без пары в БД (по source_url или catalog_number+title)
 * - Дубли JSON: несколько файлов на один продукт (catalog_number+title) — лишние URL
 * - Пустой face_value в БД при заполненном в JSON (можно подтянуть)
 * - Дубли в БД: несколько записей на один catalog_number+title
 *
 * Рекомендуемый порядок (без точечных проверок):
 * 1. Список URL: один раз с листинга; при появлении дублей — оставить один URL на продукт (см. find-perth-json-duplicates.js по catalog_number+title).
 * 2. Fetch: node scripts/fetch-perth-mint-coin.js — каждый URL один раз, в JSON пишется source_url.
 * 3. Импорт: node scripts/import-perth-mint-to-db.js — совпадение по source_url, затем по catalog_number (дубль не создаётся).
 * 4. Проверка: node scripts/validate-perth-data.js — смотреть отчёт и при необходимости удалить лишние JSON/записи или подтянуть номиналы.
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

function loadJsonCoins() {
  const files = fs.readdirSync(DATA_DIR)
    .filter((f) => f.startsWith("perth-mint-") && f.endsWith(".json") && f !== "perth-mint-fetch-progress.json" && f !== "perth-mint-image-url-cache.json");
  const list = [];
  const bySourceUrl = new Map();
  const byKey = new Map(); // catalog_number + "\n" + normalized title
  for (const f of files) {
    try {
      const data = JSON.parse(fs.readFileSync(path.join(DATA_DIR, f), "utf8"));
      const c = data.coin;
      if (!c || !c.catalog_number) continue;
      const title = (c.title || "").trim().toLowerCase();
      const key = (c.catalog_number || "").trim() + "\n" + title;
      const sourceUrl = (c.source_url || "").trim() || null;
      list.push({ file: f, ...c, key, sourceUrl });
      if (sourceUrl) bySourceUrl.set(sourceUrl, list[list.length - 1]);
      if (!byKey.has(key)) byKey.set(key, []);
      byKey.get(key).push(list[list.length - 1]);
    } catch (e) {
      // skip
    }
  }
  return { list, bySourceUrl, byKey };
}

async function main() {
  const { list, bySourceUrl, byKey } = loadJsonCoins();
  const conn = await mysql.createConnection(getConfig());
  const [rows] = await conn.execute(
    `SELECT id, title, catalog_number, source_url, face_value, country FROM coins
     WHERE mint LIKE '%Perth%' OR mint_short LIKE '%Perth%'
     ORDER BY id`
  );
  await conn.end();

  const dbBySourceUrl = new Map();
  const dbByKey = new Map();
  rows.forEach((r) => {
    const title = (r.title || "").trim().toLowerCase();
    const key = (r.catalog_number || "").trim() + "\n" + title;
    const su = (r.source_url || "").trim() || null;
    if (su) dbBySourceUrl.set(su, r);
    if (!dbByKey.has(key)) dbByKey.set(key, []);
    dbByKey.get(key).push(r);
  });

  let err = 0;

  // 1) JSON без пары в БД
  const jsonWithoutDb = [];
  for (const j of list) {
    const hasByUrl = j.sourceUrl && dbBySourceUrl.has(j.sourceUrl);
    const arr = dbByKey.get(j.key) || [];
    const hasByKey = arr.some((r) => (r.catalog_number || "").trim() === (j.catalog_number || "").trim());
    if (!hasByUrl && !hasByKey) jsonWithoutDb.push({ file: j.file, title: j.title, catalog_number: j.catalog_number, source_url: j.sourceUrl });
  }
  if (jsonWithoutDb.length) {
    console.log("--- JSON без записи в БД (по source_url и catalog_number+title):", jsonWithoutDb.length);
    jsonWithoutDb.slice(0, 20).forEach((x) => console.log("  ", x.file, "|", (x.title || "").substring(0, 50)));
    if (jsonWithoutDb.length > 20) console.log("  ... и ещё", jsonWithoutDb.length - 20);
    console.log("");
    err += jsonWithoutDb.length;
  }

  // 2) Дубли JSON (один продукт — несколько файлов)
  const duplicateJson = [];
  byKey.forEach((arr, key) => {
    if (arr.length < 2) return;
    const withUrl = arr.filter((a) => a.sourceUrl);
    duplicateJson.push({ key: key.replace("\n", " | "), count: arr.length, files: arr.map((a) => a.file) });
  });
  if (duplicateJson.length) {
    console.log("--- Дубли JSON (одинаковые catalog_number + title):", duplicateJson.length);
    duplicateJson.slice(0, 15).forEach((x) => console.log("  ", x.key.substring(0, 60), "→ файлов:", x.count));
    if (duplicateJson.length > 15) console.log("  ... и ещё", duplicateJson.length - 15);
    console.log("");
    err += duplicateJson.length;
  }

  // 3) Пустой face_value в БД при наличии в JSON
  const missingFace = [];
  for (const j of list) {
    if (!j.face_value || String(j.face_value).trim() === "") continue;
    const r = (j.sourceUrl && dbBySourceUrl.get(j.sourceUrl)) || (dbByKey.get(j.key) || [])[0];
    if (r && (!r.face_value || String(r.face_value).trim() === "")) missingFace.push({ id: r.id, title: r.title, jsonFace: j.face_value });
  }
  if (missingFace.length) {
    console.log("--- В БД пустой номинал, в JSON есть:", missingFace.length);
    missingFace.slice(0, 15).forEach((x) => console.log("  id=" + x.id, (x.title || "").substring(0, 50), "→", x.jsonFace));
    if (missingFace.length > 15) console.log("  ... и ещё", missingFace.length - 15);
    console.log("");
    err += missingFace.length;
  }

  // 4) В БД пустой face_value (все Perth)
  const dbMissingFace = rows.filter((r) => !r.face_value || String(r.face_value).trim() === "");
  if (dbMissingFace.length) {
    console.log("--- Всего записей Perth в БД с пустым номиналом:", dbMissingFace.length);
    dbMissingFace.slice(0, 10).forEach((r) => console.log("  id=" + r.id, r.country, (r.title || "").substring(0, 45)));
    if (dbMissingFace.length > 10) console.log("  ... и ещё", dbMissingFace.length - 10);
    console.log("");
  }

  // 5) Дубли в БД (один catalog_number+title — несколько id)
  const duplicateDb = [];
  dbByKey.forEach((arr, key) => {
    if (arr.length < 2) return;
    duplicateDb.push({ key: key.replace("\n", " | "), ids: arr.map((r) => r.id) });
  });
  if (duplicateDb.length) {
    console.log("--- Дубли в БД (одинаковые catalog_number + title):", duplicateDb.length);
    duplicateDb.slice(0, 15).forEach((x) => console.log("  ", x.key.substring(0, 55), "→ id:", x.ids.join(", ")));
    if (duplicateDb.length > 15) console.log("  ... и ещё", duplicateDb.length - 15);
    console.log("");
    err += duplicateDb.length;
  }

  if (err === 0 && duplicateJson.length === 0 && duplicateDb.length === 0) {
    console.log("Критичных расхождений нет. Пустой номинал в БД см. выше (можно заполнить из JSON).");
  } else {
    console.log("Итого проблем:", err + duplicateJson.length + duplicateDb.length);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
