/**
 * Диагностика: сколько записей Perth в БД, сколько уникальных source_url,
 * откуда могли взяться дубликаты. Ожидается ~965 монет Perth (по числу каноников с source_url).
 *
 * Запуск: node scripts/count-perth-and-duplicates.js
 */
require("dotenv").config({ path: ".env" });
const mysql = require("mysql2/promise");
const fs = require("fs");
const path = require("path");

function getConfig() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL не задан");
  const m = url.match(/mysql:\/\/([^:]+):([^@]+)@([^:]+):(\d+)\/(.+)/);
  if (!m) throw new Error("Неверный формат DATABASE_URL");
  const [, user, password, host, port, database] = m;
  return { host, port: parseInt(port, 10), user, password, database };
}

async function main() {
  const conn = await mysql.createConnection(getConfig());

  const [rows] = await conn.execute(
    `SELECT id, title, catalog_number, catalog_suffix, source_url
     FROM coins WHERE (mint LIKE '%Perth%' OR mint_short LIKE '%Perth%') ORDER BY id`
  );

  const totalPerth = rows.length;
  const withSourceUrl = rows.filter((r) => r.source_url && String(r.source_url).trim());
  const uniqueSourceUrl = new Set(withSourceUrl.map((r) => String(r.source_url).trim().replace(/\/+$/, "")));
  const withoutSourceUrl = totalPerth - withSourceUrl.length;

  // Дубликаты по source_url (один URL — несколько записей)
  const byUrl = new Map();
  withSourceUrl.forEach((r) => {
    const u = String(r.source_url).trim().replace(/\/+$/, "");
    if (!byUrl.has(u)) byUrl.set(u, []);
    byUrl.get(u).push(r);
  });
  const duplicateUrls = [...byUrl.entries()].filter(([, arr]) => arr.length > 1);

  // Дубликаты по (title, catalog_number, catalog_suffix)
  const byKey = new Map();
  rows.forEach((r) => {
    const key = (r.title || "").trim().toLowerCase() + "\n" + (r.catalog_number || "").trim() + "\n" + (r.catalog_suffix || "").trim();
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key).push(r);
  });
  const duplicateKeys = [...byKey.entries()].filter(([, arr]) => arr.length > 1);
  const totalDuplicateRows = duplicateKeys.reduce((s, [, arr]) => s + arr.length - 1, 0);

  const dataDir = path.join(__dirname, "..", "data");
  let canonicalCount = 0;
  if (fs.existsSync(dataDir)) {
    canonicalCount = fs.readdirSync(dataDir)
      .filter((f) => f.startsWith("perth-mint-") && f.endsWith(".json"))
      .length;
  }

  console.log("=== Perth Mint в БД ===\n");
  console.log("Записей Perth в БД (mint/ short LIKE '%Perth%'):", totalPerth);
  console.log("Уникальных source_url (Perth):", uniqueSourceUrl.size);
  console.log("Записей без source_url:", withoutSourceUrl);
  console.log("");
  console.log("Канонических файлов data/perth-mint-*.json:", canonicalCount);
  console.log("Ожидается монет Perth (по каноникам): ~", canonicalCount, "\n");

  if (duplicateUrls.length > 0) {
    console.log("--- Один source_url — несколько записей (явные дубликаты по URL) ---");
    console.log("Таких URL:", duplicateUrls.length, ", лишних записей:", duplicateUrls.reduce((s, [, arr]) => s + arr.length - 1, 0));
    duplicateUrls.slice(0, 5).forEach(([url, arr]) => {
      console.log("  ", url.slice(-55), "→ id:", arr.map((r) => r.id).join(", "));
    });
    if (duplicateUrls.length > 5) console.log("  ... и ещё", duplicateUrls.length - 5);
    console.log("");
  }

  if (duplicateKeys.length > 0) {
    console.log("--- Одинаковые title + catalog_number + catalog_suffix ---");
    console.log("Групп:", duplicateKeys.length, ", лишних записей (дубликатов):", totalDuplicateRows);
    console.log("");
  }

  console.log("--- Возможные причины дубликатов ---");
  console.log("1. Импорт одного и того же продукта из разных файлов (разный slug → разный catalog_number в byCatalog) → два INSERT.");
  console.log("2. Раньше импорт был по catalog_number без source_url; потом у нескольких записей оказался один catalog_number → одна запись обновлялась, остальные не находились и не создавались заново, но при повторном импорте с source_url мог создаться новый INSERT для «того же» продукта.");
  console.log("3. Один продукт на сайте Perth сохранён в два файла с разным source_url (например с/без trailing slash) → два разных URL, два INSERT.");
  console.log("4. После массовой перезаписи fix-perth восстанавливал по спекам; если у двух записей одинаковые спеки и один каноник подходил, использовалось правило «один каноник — одна запись», но записи с тем же source_url уже могли существовать (до перезаписи) → дубль по source_url.");
  console.log("");
  console.log("Рекомендация: удалить только безопасные дубликаты (check-duplicate-coins-safe.js, remove-duplicate-coins.js), затем пересчитать. Цель: число записей Perth ≈ число каноников с source_url.");
  await conn.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
