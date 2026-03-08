/**
 * Анализ монет Великобритании в БД: подсчёт, дубликаты по source_url и по (title + вес + диаметр + металл).
 * Запуск: node scripts/analyze-british-coins.js
 */
require("dotenv").config({ path: ".env" });
const mysql = require("mysql2/promise");

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

function trim(s) {
  return s != null && String(s).trim() || "";
}

async function main() {
  const conn = await mysql.createConnection(getConfig());

  const [rows] = await conn.execute(
    `SELECT id, title, catalog_number, catalog_suffix, mint, mint_short, country, source_url, weight_g, diameter_mm, metal
     FROM coins
     WHERE country LIKE '%Великобритания%' OR country = 'United Kingdom'
     ORDER BY title, id`
  );

  console.log("=== Монеты Великобритании в БД ===\n");
  console.log("Всего записей:", rows.length);

  // Группировка по source_url (один URL = одна монета; дубли = несколько строк с одним URL)
  const bySourceUrl = new Map();
  for (const r of rows) {
    const url = normUrl(r.source_url);
    if (!url) continue;
    if (!bySourceUrl.has(url)) bySourceUrl.set(url, []);
    bySourceUrl.get(url).push(r);
  }

  const duplicateByUrl = [];
  for (const [url, arr] of bySourceUrl) {
    if (arr.length > 1) duplicateByUrl.push({ url, arr });
  }

  console.log("\n--- Дубликаты по source_url (один URL — несколько записей) ---");
  console.log("Групп с дубликатами:", duplicateByUrl.length);
  let totalDupByUrl = 0;
  for (const { url, arr } of duplicateByUrl) {
    arr.sort((a, b) => a.id - b.id);
    totalDupByUrl += arr.length - 1;
    const title = (arr[0].title || "").slice(0, 55);
    console.log("\n  " + title);
    console.log("  URL: " + url.slice(0, 70) + (url.length > 70 ? "…" : ""));
    arr.forEach((r) => console.log("    id=" + r.id + "  catalog=" + (r.catalog_number || "") + "  " + (r.catalog_suffix || "")));
  }
  console.log("\n  Итого лишних записей по source_url (оставляем по одной на URL):", totalDupByUrl);

  // Группировка по title + weight_g + diameter_mm + metal (на случай разных source_url при одной монете)
  const byTitleSpecs = new Map();
  for (const r of rows) {
    const w = r.weight_g != null ? String(r.weight_g).trim() : "";
    const d = r.diameter_mm != null ? String(r.diameter_mm).trim() : "";
    const m = trim(r.metal) || "";
    const key = (trim(r.title) || "").toLowerCase() + "|" + w + "|" + d + "|" + m;
    if (!byTitleSpecs.has(key)) byTitleSpecs.set(key, []);
    byTitleSpecs.get(key).push(r);
  }

  const duplicateByTitleSpecs = [];
  for (const [key, arr] of byTitleSpecs) {
    if (arr.length > 1) duplicateByTitleSpecs.push({ key, arr });
  }

  console.log("\n--- Дубликаты по title + weight_g + diameter_mm + metal ---");
  console.log("Групп с дубликатами:", duplicateByTitleSpecs.length);
  let totalDupBySpecs = 0;
  for (const { arr } of duplicateByTitleSpecs) {
    arr.sort((a, b) => a.id - b.id);
    totalDupBySpecs += arr.length - 1;
    const title = (arr[0].title || "").slice(0, 55);
    console.log("\n  «" + title + "»  weight_g=" + arr[0].weight_g + "  diameter_mm=" + arr[0].diameter_mm + "  metal=" + (arr[0].metal || ""));
    arr.forEach((r) => console.log("    id=" + r.id + "  source_url=" + (r.source_url ? "yes" : "no")));
  }
  console.log("\n  Итого лишних записей по title+specs:", totalDupBySpecs);

  // Сводка: какие id удалить (оставить min(id) в каждой группе по source_url)
  const idsToRemoveByUrl = new Set();
  for (const { arr } of duplicateByUrl) {
    arr.sort((a, b) => a.id - b.id);
    for (let i = 1; i < arr.length; i++) idsToRemoveByUrl.add(arr[i].id);
  }

  if (idsToRemoveByUrl.size > 0) {
    console.log("\n--- Рекомендация: удалить дубликаты по source_url (оставить одну запись на URL) ---");
    console.log("ID к удалению:", [...idsToRemoveByUrl].sort((a, b) => a - b).join(", "));
  }

  await conn.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
