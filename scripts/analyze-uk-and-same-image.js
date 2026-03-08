/**
 * Анализ: 1) монеты Великобритании — дубликаты по source_url и по (title+specs);
 *         2) одна и та же картинка у разных монет (image_obverse) — UK и Australia Sovereign.
 * Запуск: node scripts/analyze-uk-and-same-image.js
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

  // --- Великобритания: все записи ---
  const [ukRows] = await conn.execute(
    `SELECT id, title, catalog_number, catalog_suffix, mint, mint_short, country, source_url, weight_g, diameter_mm, metal, image_obverse, image_reverse
     FROM coins
     WHERE country LIKE '%Великобритания%' OR country = 'United Kingdom'
     ORDER BY title, id`
  );

  console.log("=== Монеты Великобритании в БД ===\n");
  console.log("Всего записей:", ukRows.length);

  // Дубликаты по source_url
  const bySourceUrl = new Map();
  for (const r of ukRows) {
    const url = normUrl(r.source_url);
    if (!url) continue;
    if (!bySourceUrl.has(url)) bySourceUrl.set(url, []);
    bySourceUrl.get(url).push(r);
  }
  const duplicateByUrl = [];
  for (const [url, arr] of bySourceUrl) {
    if (arr.length > 1) duplicateByUrl.push({ url, arr });
  }
  console.log("\n--- Дубликаты по source_url ---");
  console.log("Групп с дубликатами:", duplicateByUrl.length);
  let totalDupByUrl = 0;
  for (const { url, arr } of duplicateByUrl) {
    totalDupByUrl += arr.length - 1;
    console.log("  «" + (arr[0].title || "").slice(0, 55) + "»  id: " + arr.map((r) => r.id).join(", "));
  }
  console.log("  Лишних записей (оставить по одной на URL):", totalDupByUrl);

  // Дубликаты по title + weight + diameter + metal
  const byTitleSpecs = new Map();
  for (const r of ukRows) {
    const w = r.weight_g != null ? String(r.weight_g).trim() : "";
    const d = r.diameter_mm != null ? String(r.diameter_mm).trim() : "";
    const m = trim(r.metal) || "";
    const key = (trim(r.title) || "").toLowerCase() + "|" + w + "|" + d + "|" + m;
    if (!byTitleSpecs.has(key)) byTitleSpecs.set(key, []);
    byTitleSpecs.get(key).push(r);
  }
  const duplicateByTitleSpecs = [];
  for (const [, arr] of byTitleSpecs) {
    if (arr.length > 1) duplicateByTitleSpecs.push({ arr });
  }
  console.log("\n--- Дубликаты по title + weight_g + diameter_mm + metal ---");
  console.log("Групп:", duplicateByTitleSpecs.length);
  let totalDupBySpecs = 0;
  for (const { arr } of duplicateByTitleSpecs) {
    totalDupBySpecs += arr.length - 1;
    console.log("  «" + (arr[0].title || "").slice(0, 55) + "»  id: " + arr.map((r) => r.id).join(", "));
  }
  console.log("  Лишних записей:", totalDupBySpecs);

  // --- Одна картинка у разных монет: группировка по image_obverse ---
  const [allWithImage] = await conn.execute(
    `SELECT id, title, country, series, mint, image_obverse
     FROM coins
     WHERE image_obverse IS NOT NULL AND TRIM(image_obverse) != ''
     ORDER BY image_obverse, id`
  );

  const byObverse = new Map();
  for (const r of allWithImage) {
    const obv = String(r.image_obverse).trim();
    if (!byObverse.has(obv)) byObverse.set(obv, []);
    byObverse.get(obv).push(r);
  }

  // UK: одна картинка — несколько монет
  console.log("\n=== Одна картинка у разных монет (Великобритания) ===\n");
  let ukSameImage = 0;
  for (const [obv, arr] of byObverse) {
    const uk = arr.filter((r) => (r.country || "").includes("Великобритания") || (r.country || "") === "United Kingdom");
    if (uk.length <= 1) continue;
    ukSameImage += uk.length - 1;
    console.log("  image_obverse: " + obv.slice(-55));
    uk.forEach((r) => console.log("    id=" + r.id + "  " + (r.title || "").slice(0, 60)));
    console.log("");
  }
  console.log("  Всего UK записей с «общей» картинкой (лишние копии изображения):", ukSameImage);

  // Australia Sovereign / Half / Double: одна картинка — несколько монет (разные годы)
  console.log("\n=== Одна картинка у разных монет (Австралия: Sovereign / Half / Double) ===\n");
  const sovereignTitles = /australia (half |double )?sovereign|sovereign.*australia/i;
  let auSameImage = 0;
  for (const [obv, arr] of byObverse) {
    const au = arr.filter((r) => (r.country || "").includes("Австралия") && sovereignTitles.test(r.title || ""));
    if (au.length <= 1) continue;
    auSameImage += au.length - 1;
    console.log("  image_obverse: " + obv.slice(-60));
    au.forEach((r) => console.log("    id=" + r.id + "  " + (r.title || "").slice(0, 65)));
    console.log("");
  }
  console.log("  Всего таких записей Австралии с «общей» картинкой:", auSameImage);

  // Сводка: сколько монет без своей картинки (image_obverse пустой) — получат placeholder
  const [noImage] = await conn.execute(
    `SELECT COUNT(*) AS c FROM coins WHERE (image_obverse IS NULL OR TRIM(image_obverse) = '') AND (country LIKE '%Великобритания%' OR country = 'United Kingdom')`
  );
  console.log("\n--- UK монеты без своей картинки (на сайте будет placeholder):", noImage[0].c);

  // Все с "Sovereign" в title (могут показываться как UK на фронте по серии) — группировка по image_obverse
  const [sovereignRows] = await conn.execute(
    `SELECT id, title, country, series, mint, image_obverse FROM coins WHERE title LIKE '%Sovereign%' ORDER BY image_obverse, id`
  );
  console.log("\n=== Монеты с 'Sovereign' в названии (всего " + sovereignRows.length + ") ===\n");
  const byObvSov = new Map();
  for (const r of sovereignRows) {
    const obv = (r.image_obverse && String(r.image_obverse).trim()) || "(нет)";
    if (!byObvSov.has(obv)) byObvSov.set(obv, []);
    byObvSov.get(obv).push(r);
  }
  for (const [obv, arr] of byObvSov) {
    if (arr.length <= 1) continue;
    console.log("  Одна картинка у " + arr.length + " монет: " + (obv.length > 60 ? obv.slice(-60) : obv));
    arr.forEach((r) => console.log("    id=" + r.id + "  " + (r.country || "") + "  " + (r.title || "").slice(0, 55)));
    console.log("");
  }

  // Ссылки на монеты с повторяющейся картинкой (пустой image_obverse) — для просмотра/удаления
  const noImageSovereign = sovereignRows.filter(
    (r) => !r.image_obverse || !String(r.image_obverse).trim()
  );
  const baseUrl = process.env.SITE_URL || "http://localhost:3000";
  console.log("\n=== Ссылки на монеты с одной и той же картинкой (placeholder), всего " + noImageSovereign.length + " ===\n");
  noImageSovereign.forEach((r) => {
    console.log(baseUrl + "/coins/" + r.id + "/");
    console.log("  " + (r.title || "").slice(0, 70) + "  [" + (r.country || "") + "]\n");
  });

  await conn.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
