/**
 * Поиск всех дубликатов Тувалу/Австралия по одинаковому названию (полные записи, без фильтра по source_url).
 * Результат: data/perth-country-duplicates-full.json — список групп с полными полями для проверки.
 *
 * Запуск: node scripts/list-perth-country-duplicates-full.js
 */
require("dotenv").config({ path: ".env" });
const mysql = require("mysql2/promise");
const fs = require("fs");
const path = require("path");

const OUT_FILE = path.join(__dirname, "..", "data", "perth-country-duplicates-full.json");

function getConfig() {
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
  return { host, port: parseInt(port, 10), user, password, database };
}

async function main() {
  const conn = await mysql.createConnection(getConfig());
  const [rows] = await conn.execute(
    `SELECT id, title, country, source_url, catalog_number, mint, face_value, metal, release_date
     FROM coins
     WHERE (country = 'Тувалу' OR country = 'Австралия')
     ORDER BY LOWER(TRIM(title)), country`
  );
  await conn.end();

  const byTitle = new Map();
  rows.forEach((r) => {
    const key = (r.title || "").trim().toLowerCase();
    if (!key) return;
    if (!byTitle.has(key)) byTitle.set(key, []);
    byTitle.get(key).push({
      id: r.id,
      title: r.title,
      country: r.country,
      source_url: r.source_url || null,
      catalog_number: r.catalog_number || null,
      mint: r.mint || null,
      face_value: r.face_value || null,
      metal: r.metal || null,
      release_date: r.release_date ? String(r.release_date) : null,
      link: "/coins/" + r.id + "/",
    });
  });

  const groups = [];
  byTitle.forEach((arr, titleKey) => {
    if (arr.length < 2) return;
    const countries = [...new Set(arr.map((a) => a.country))];
    if (!countries.includes("Тувалу") || !countries.includes("Австралия")) return;
    groups.push({
      title_normalized: titleKey,
      title_display: arr[0].title,
      count: arr.length,
      records: arr,
    });
  });

  const report = {
    generated_at: new Date().toISOString(),
    note: "Дубликаты по названию: одна и та же монета с Тувалу и Австралия (без фильтра по source_url).",
    total_groups: groups.length,
    total_duplicate_records: groups.reduce((s, g) => s + g.records.length, 0),
    groups,
  };

  const dir = path.dirname(OUT_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(OUT_FILE, JSON.stringify(report, null, 2), "utf8");

  console.log("Групп (одинаковое название, Тувалу + Австралия):", report.total_groups);
  console.log("Всего записей в группах:", report.total_duplicate_records);
  console.log("Файл:", OUT_FILE);
  groups.forEach((g, i) => {
    console.log("\n--- Группа " + (i + 1) + ": «" + (g.title_display || "").substring(0, 55) + "» ---");
    g.records.forEach((r) => console.log("  " + r.link + " id=" + r.id + " [" + r.country + "]" + (r.source_url ? " " + r.source_url : "")));
  });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
