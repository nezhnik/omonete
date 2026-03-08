/**
 * Разводит записи «Great War Gold Sovereign 1914–1918» по годам: у каждой записи своё название
 * (Great War Gold Sovereign 1914, …) и своя картинка. Использует канонические JSON по годам
 * (mintmark trio 1914–1918). Сопоставление: по source_url (годовая страница Perth), иначе
 * round-robin по id (1914, 1915, 1916, 1917, 1918).
 * Для корректных картинок 1916/1917 при необходимости: перефетч страниц Perth (--refresh), затем запуск скрипта.
 *
 * Запуск: node scripts/fix-great-war-coins.js [--dry]
 */
require("dotenv").config({ path: ".env" });
const mysql = require("mysql2/promise");
const fs = require("fs");
const path = require("path");
const { roundSpec, normalizeWeightG, formatWeightG } = require("./format-coin-characteristics.js");

const DATA_DIR = path.join(__dirname, "..", "data");

const GREAT_WAR_YEAR_URLS = [
  "https://www.perthmint.com/shop/collector-coins/sovereigns/1914-gold-sovereign-mintmark-trio",
  "https://www.perthmint.com/shop/collector-coins/sovereigns/1915-gold-sovereign-mintmark-trio",
  "https://www.perthmint.com/shop/collector-coins/sovereigns/1916-king-george-v-gold-sovereign-mintmark-trio",
  "https://www.perthmint.com/shop/collector-coins/sovereigns/1917-gold-sovereign-mintmark-trio",
  "https://www.perthmint.com/shop/collector-coins/sovereigns/1918-gold-sovereign-mintmark-trio",
];

const GREAT_WAR_CANONICAL_FILES = [
  "perth-mint-1914-gold-sovereign-mintmark-trio-2025.json",
  "perth-mint-1915-gold-sovereign-mintmark-trio-2025.json",
  "perth-mint-1916-king-george-v-gold-sovereign-mintmark-trio.json",
  "perth-mint-1917-gold-sovereign-mintmark-trio-2026.json",
  "perth-mint-1918-gold-sovereign-mintmark-trio-2025.json",
];

const YEARS = [1914, 1915, 1916, 1917, 1918];

function getConfig() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL не задан");
  const m = url.match(/mysql:\/\/([^:]+):([^@]+)@([^:]+):(\d+)\/(.+)/);
  if (!m) throw new Error("Неверный формат DATABASE_URL");
  const [, user, password, host, port, database] = m;
  return { host, port: parseInt(port, 10), user, password, database };
}

function trim(s) {
  return s != null && typeof s === "string" ? s.trim() || null : null;
}

function normUrl(url) {
  return trim(url) ? trim(url).replace(/\/+$/, "").toLowerCase() : null;
}

/** Загружаем 5 каноников Great War по годам (1914–1918, mintmark trio). */
function loadCanonicals() {
  const out = [];
  for (let i = 0; i < GREAT_WAR_CANONICAL_FILES.length; i++) {
    const filePath = path.join(DATA_DIR, GREAT_WAR_CANONICAL_FILES[i]);
    if (!fs.existsSync(filePath)) {
      console.warn("  Нет файла:", GREAT_WAR_CANONICAL_FILES[i]);
      continue;
    }
    const raw = JSON.parse(fs.readFileSync(filePath, "utf8"));
    const c = raw?.coin;
    const saved = raw?.saved;
    if (!c) continue;
    const year = YEARS[i];
    // Картинка: приоритет у saved.reverse (уже скачан по году), иначе coin.image_reverse
    let imageReverse = (saved && trim(saved.reverse)) || trim(c.image_reverse) || null;
    const title = "Great War Gold Sovereign " + year;
    out.push({
      year,
      title,
      catalog_number: "AU-PERTH-GREAT-WAR-" + year,
      catalog_suffix: trim(c.catalog_suffix) || null,
      source_url: normUrl(c.source_url) || normUrl(GREAT_WAR_YEAR_URLS[i]),
      country: "Австралия",
      series: "Perth Mint Great War",
      face_value: null,
      mint: trim(c.mint) || "The Perth Mint",
      mint_short: trim(c.mint_short) || "Perth Mint",
      metal: trim(c.metal),
      metal_fineness: c.metal_fineness != null ? String(c.metal_fineness).replace(/%\s*pure gold/, "").trim() : null,
      mintage: c.mintage != null ? c.mintage : null,
      weight_g: c.weight_g != null ? normalizeWeightG(c.weight_g) : null,
      weight_oz: c.weight_oz != null ? c.weight_oz : null,
      diameter_mm: c.diameter_mm != null ? (roundSpec(parseFloat(c.diameter_mm)) ?? c.diameter_mm) : null,
      thickness_mm: c.thickness_mm != null ? (roundSpec(parseFloat(c.thickness_mm)) ?? c.thickness_mm) : null,
      quality: trim(c.quality),
      image_obverse: trim(c.image_obverse) || null,
      image_reverse: imageReverse,
      image_box: trim(c.image_box) || null,
      image_certificate: trim(c.image_certificate) || null,
      price_display: trim(c.price_display) || null,
      release_date: year + "-01-01",
    });
  }
  return out;
}

/** Сопоставить строку БД с каноником по годам: по source_url, иначе по индексу round-robin. */
function assignCanonicalByIndex(row, canonicals, indexByRow) {
  const src = normUrl(row.source_url);
  if (src) {
    const idx = GREAT_WAR_YEAR_URLS.findIndex((u) => normUrl(u) === src);
    if (idx >= 0 && canonicals[idx]) return canonicals[idx];
  }
  return canonicals[indexByRow % canonicals.length];
}

async function main() {
  const dryRun = process.argv.includes("--dry");
  if (dryRun) console.log("Режим --dry: изменения не применяются.\n");

  const canonicals = loadCanonicals();
  if (canonicals.length === 0) {
    console.error("Нет канонических JSON Great War по годам в data/");
    process.exit(1);
  }
  console.log("Каноники по годам:", canonicals.map((c) => c.title).join(" | "));

  const conn = await mysql.createConnection(getConfig());
  const [rows] = await conn.execute(
    `SELECT id, title, catalog_number, source_url, metal, weight_g, diameter_mm, mint, mint_short
     FROM coins
     WHERE (title LIKE '%Great War%' AND title LIKE '%1914%')
        OR (title LIKE '%Great War%' AND title LIKE '%1918%')
     AND (mint LIKE '%Perth%' OR mint_short LIKE '%Perth%')
     ORDER BY id`
  );

  if (rows.length === 0) {
    console.log("Записей Great War 1914–1918 в БД не найдено.");
    await conn.end();
    return;
  }

  console.log("Найдено записей Great War в БД:", rows.length);

  const cols = [
    "title", "series", "country", "face_value", "mint", "mint_short", "metal", "metal_fineness",
    "mintage", "weight_g", "weight_oz", "release_date", "catalog_number", "catalog_suffix", "quality",
    "diameter_mm", "thickness_mm",
    "image_obverse", "image_reverse", "image_box", "image_certificate", "price_display", "source_url",
  ];
  const setClause = cols.map((k) => `${k} = ?`).join(", ");

  let updated = 0;
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const canon = assignCanonicalByIndex(row, canonicals, i);
    const weightGForDb = canon.weight_g != null ? (formatWeightG(canon.weight_g) ?? String(canon.weight_g)) : null;
    const values = [
      canon.title,
      canon.series,
      canon.country,
      canon.face_value,
      canon.mint,
      canon.mint_short,
      canon.metal,
      canon.metal_fineness,
      canon.mintage,
      weightGForDb,
      canon.weight_oz,
      canon.release_date,
      canon.catalog_number,
      canon.catalog_suffix,
      canon.quality,
      canon.diameter_mm,
      canon.thickness_mm,
      canon.image_obverse,
      canon.image_reverse,
      canon.image_box,
      canon.image_certificate,
      canon.price_display,
      canon.source_url,
    ];
    if (dryRun) {
      console.log("  [dry] id=" + row.id + " -> " + canon.title + (canon.image_reverse ? " [img]" : ""));
      updated++;
      continue;
    }
    await conn.execute(`UPDATE coins SET ${setClause} WHERE id = ?`, [...values, row.id]);
    updated++;
    console.log("  id=" + row.id + " -> " + canon.title);
  }

  await conn.end();
  console.log("\n✓ Обновлено записей Great War по годам:", updated);
  if (updated > 0 && !dryRun) {
    console.log("Дальше: node scripts/export-coins-to-json.js (и сборка), чтобы каталог отобразил изменения.");
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
