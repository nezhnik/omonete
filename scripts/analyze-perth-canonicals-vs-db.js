/**
 * Сравнение каноников Perth (data/perth-mint-*.json) с БД.
 * Источник истины: каноники с source_url = ровно 965 продуктов (или сколько есть в файлах).
 * Находим: чего нет в БД (не импортировали или перезаписали), что дублируется, что лишнее в БД.
 *
 * Запуск: node scripts/analyze-perth-canonicals-vs-db.js
 */
require("dotenv").config({ path: ".env" });
const mysql = require("mysql2/promise");
const fs = require("fs");
const path = require("path");

const DATA_DIR = path.join(__dirname, "..", "data");

function getConfig() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL не задан");
  const m = url.match(/mysql:\/\/([^:]+):([^@]+)@([^:]+):(\d+)\/(.+)/);
  if (!m) throw new Error("Неверный формат DATABASE_URL");
  const [, user, password, host, port, database] = m;
  return { host, port: parseInt(port, 10), user, password, database };
}

function normUrl(u) {
  if (!u || typeof u !== "string") return null;
  return u.trim().replace(/\/+$/, "") || null;
}

/** Собираем из каноников: source_url → { title, file } (только с perthmint.com) */
function loadCanonicalUrls() {
  if (!fs.existsSync(DATA_DIR)) return new Map();
  const files = fs.readdirSync(DATA_DIR)
    .filter((f) => f.startsWith("perth-mint-") && f.endsWith(".json"))
    .map((f) => path.join(DATA_DIR, f));

  const byUrl = new Map();
  for (const fp of files) {
    let raw;
    try {
      raw = JSON.parse(fs.readFileSync(fp, "utf8"));
    } catch {
      continue;
    }
    const c = raw?.coin;
    if (!c?.source_url || !String(c.source_url).includes("perthmint.com")) continue;
    const url = normUrl(c.source_url);
    if (!url) continue;
    if (!byUrl.has(url)) {
      byUrl.set(url, { title: (c.title || "").slice(0, 60), file: path.basename(fp) });
    }
  }
  return byUrl;
}

async function main() {
  const canonicalByUrl = loadCanonicalUrls();
  const expectedCount = canonicalByUrl.size;
  console.log("=== Каноники (источник истины) ===\n");
  console.log("Файлов perth-mint-*.json с source_url (perthmint.com):", expectedCount);
  console.log("Ожидаемое число монет Perth в БД:", expectedCount, "\n");

  const conn = await mysql.createConnection(getConfig());
  const [rows] = await conn.execute(
    `SELECT id, title, catalog_number, source_url
     FROM coins WHERE (mint LIKE '%Perth%' OR mint_short LIKE '%Perth%') ORDER BY id`
  );
  await conn.end();

  const dbByUrl = new Map();
  rows.forEach((r) => {
    const url = normUrl(r.source_url);
    if (!url) return;
    if (!dbByUrl.has(url)) dbByUrl.set(url, []);
    dbByUrl.get(url).push({ id: r.id, title: r.title, catalog_number: r.catalog_number });
  });

  const inCanonical = new Set(canonicalByUrl.keys());
  const inDb = new Set(dbByUrl.keys());

  const missingInDb = [];   // есть в канониках, в БД 0 записей с таким source_url
  const duplicatedInDb = []; // есть в канониках, в БД >1 записей
  const okInDb = [];        // есть в канониках, в БД ровно 1 запись
  const onlyInDb = [];      // есть в БД, нет в канониках (старые/чужие URL)

  for (const url of inCanonical) {
    const dbRows = dbByUrl.get(url) || [];
    const info = canonicalByUrl.get(url);
    if (dbRows.length === 0) missingInDb.push({ url, ...info });
    else if (dbRows.length === 1) okInDb.push({ url, ...info, id: dbRows[0].id });
    else duplicatedInDb.push({ url, ...info, rows: dbRows });
  }
  for (const url of inDb) {
    if (!inCanonical.has(url)) onlyInDb.push(url);
  }

  console.log("=== Сравнение с БД ===\n");
  console.log("Записей Perth в БД всего:", rows.length);
  console.log("Уникальных source_url в БД:", inDb.size);
  console.log("");
  console.log("В канониках и в БД ровно 1 запись (OK):", okInDb.length);
  console.log("В канониках, в БД 0 записей (нет в БД — не импортировали или перезаписали):", missingInDb.length);
  console.log("В канониках, в БД >1 записей (дубликаты):", duplicatedInDb.length);
  console.log("В БД, нет в канониках (старый URL или другой источник):", onlyInDb.length);
  console.log("");

  if (missingInDb.length > 0) {
    console.log("--- Нет в БД (есть в канониках) — первые 20 ---");
    missingInDb.slice(0, 20).forEach(({ url, title, file }) => {
      console.log("  ", file);
      console.log("    ", (title || "").slice(0, 55));
      console.log("    ", url.slice(-70));
    });
    if (missingInDb.length > 20) console.log("  ... и ещё", missingInDb.length - 20);
    console.log("");
  }

  if (duplicatedInDb.length > 0) {
    console.log("--- Дубликаты в БД (один URL — несколько id) — первые 10 ---");
    duplicatedInDb.slice(0, 10).forEach(({ url, title, rows: r }) => {
      console.log("  ", (title || "").slice(0, 50), "→ id:", r.map((x) => x.id).join(", "));
    });
    if (duplicatedInDb.length > 10) console.log("  ... и ещё", duplicatedInDb.length - 10);
    console.log("");
  }

  const totalDuplicateRows = duplicatedInDb.reduce((s, { rows: r }) => s + r.length - 1, 0);
  console.log("--- Итог ---");
  console.log("Ожидаем в БД (по каноникам):", expectedCount, "уникальных продуктов.");
  console.log("Сейчас: OK =", okInDb.length, ", дубликатов лишних записей =", totalDuplicateRows, ", отсутствуют в БД =", missingInDb.length);
  console.log("Если удалить дубликаты (оставить по 1 id на source_url): записей Perth станет", rows.length - totalDuplicateRows);
  console.log("Если отсутствующие когда-то были перезаписаны — их данные уже под другим source_url; восстановить можно только заново импортом из каноников (import-perth-mint-to-db.js).");
  console.log("");
  console.log("--- Решение (чтобы стало 962 монеты Perth) ---");
  console.log("1. Удалить дубликаты по source_url (оставить по одной записи с min(id) на каждый URL): скрипт remove-perth-duplicates-by-source-url.js");
  console.log("2. Запустить импорт: node scripts/import-perth-mint-to-db.js — для 374 каноников без записи в БД выполнится INSERT.");
  console.log("Итого: 588 (после удаления дублей) + 374 (новые) = 962.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
