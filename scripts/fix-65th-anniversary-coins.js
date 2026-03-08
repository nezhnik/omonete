/**
 * Приводит записи «65th Anniversary QEII 2018» в БД в соответствие с каноническими JSON.
 * Сопоставление: по source_url, иначе по catalog_number, иначе по (metal, weight_g, diameter_mm).
 * Обновляет title, catalog_number, catalog_suffix, изображения, source_url и остальные поля из каноника.
 *
 * Запуск: node scripts/fix-65th-anniversary-coins.js [--dry]
 */
require("dotenv").config({ path: ".env" });
const mysql = require("mysql2/promise");
const fs = require("fs");
const path = require("path");
const { roundSpec, normalizeWeightG, formatWeightG } = require("./format-coin-characteristics.js");

const DATA_DIR = path.join(__dirname, "..", "data");

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
  return trim(url) ? trim(url).replace(/\/+$/, "") : null;
}

/** Загружаем 3 канонических JSON 65th Anniversary */
function loadCanonicals() {
  const names = [
    "perth-mint-65th-anniversary-of-the-coronation-of-her-majesty-qeii-2018-1oz-silver-proof-coin.json",
    "perth-mint-65th-anniversary-of-the-coronation-of-her-majesty-qeii-2018-1-4oz-gold-proof-coin.json",
    "perth-mint-65th-anniversary-of-the-coronation-of-her-majesty-qeii-2018-2oz-gold-proof-coin.json",
  ];
  const out = [];
  for (const name of names) {
    const filePath = path.join(DATA_DIR, name);
    if (!fs.existsSync(filePath)) continue;
    const raw = JSON.parse(fs.readFileSync(filePath, "utf8"));
    const c = raw?.coin;
    if (!c) continue;
    const catalogNumber = trim(c.catalog_number) || null;
    const sourceUrl = normUrl(c.source_url);
    const weightG = c.weight_g != null ? normalizeWeightG(c.weight_g) : null;
    const diameterMm = c.diameter_mm != null ? roundSpec(parseFloat(c.diameter_mm)) : null;
    out.push({
      title: trim(c.title),
      catalog_number: catalogNumber,
      catalog_suffix: trim(c.catalog_suffix) || null,
      source_url: sourceUrl,
      country: trim(c.country),
      series: trim(c.series),
      face_value: trim(c.face_value),
      mint: trim(c.mint),
      mint_short: trim(c.mint_short),
      metal: trim(c.metal),
      metal_fineness: trim(c.metal_fineness),
      mintage: c.mintage != null ? c.mintage : null,
      weight_g: weightG ?? c.weight_g,
      weight_oz: c.weight_oz != null ? c.weight_oz : null,
      diameter_mm: diameterMm ?? c.diameter_mm,
      thickness_mm: c.thickness_mm != null ? (roundSpec(parseFloat(c.thickness_mm)) ?? c.thickness_mm) : null,
      length_mm: c.length_mm != null ? (roundSpec(parseFloat(c.length_mm)) ?? c.length_mm) : null,
      width_mm: c.width_mm != null ? (roundSpec(parseFloat(c.width_mm)) ?? c.width_mm) : null,
      quality: trim(c.quality),
      image_obverse: trim(c.image_obverse) || null,
      image_reverse: trim(c.image_reverse) || null,
      image_box: trim(c.image_box) || null,
      image_certificate: trim(c.image_certificate) || null,
      price_display: trim(c.price_display) || null,
      release_date: (() => {
        const v = c.release_date;
        if (v == null || v === "") return null;
        const s = String(v).trim();
        if (/^(20\d{2}|19\d{2})$/.test(s)) return s + "-01-01";
        if (/^(20\d{2}|19\d{2})-\d{2}-\d{2}$/.test(s)) return s;
        return v;
      })(),
    });
  }
  return out;
}

/** Сопоставить строку БД с каноником: по source_url, catalog_number, или по металл+вес+диаметр */
function matchCanonical(row, canonicals) {
  const src = normUrl(row.source_url);
  if (src) {
    const c = canonicals.find((k) => normUrl(k.source_url) === src);
    if (c) return c;
  }
  const cat = trim(row.catalog_number);
  if (cat) {
    const c = canonicals.find((k) => trim(k.catalog_number) === cat);
    if (c) return c;
  }
  const metal = trim(row.metal);
  const w = row.weight_g != null ? normalizeWeightG(parseFloat(row.weight_g)) : null;
  const d = row.diameter_mm != null ? roundSpec(parseFloat(row.diameter_mm)) : null;
  for (const c of canonicals) {
    const cW = c.weight_g != null ? normalizeWeightG(c.weight_g) : null;
    const cD = c.diameter_mm != null ? roundSpec(c.diameter_mm) : null;
    if (trim(c.metal) === metal && cW !== null && w !== null && Math.abs(cW - w) < 1 && cD !== null && d !== null && Math.abs(cD - d) < 1) return c;
  }
  return null;
}

async function main() {
  const dryRun = process.argv.includes("--dry");
  if (dryRun) console.log("Режим --dry: изменения не применяются.\n");

  const canonicals = loadCanonicals();
  if (canonicals.length === 0) {
    console.error("Нет канонических JSON 65th Anniversary в data/");
    process.exit(1);
  }
  console.log("Канонические продукты:", canonicals.map((c) => c.title).join(" | "));

  const conn = await mysql.createConnection(getConfig());
  const [rows] = await conn.execute(
    `SELECT id, title, catalog_number, source_url, metal, weight_g, diameter_mm, mint, mint_short
     FROM coins
     WHERE (title LIKE '%65th%Anniversary%' OR title LIKE '%65th%Coronation%' OR title LIKE '%QEII%2018%')
       AND (mint LIKE '%Perth%' OR mint_short LIKE '%Perth%')
     ORDER BY id`
  );

  if (rows.length === 0) {
    console.log("Записей 65th Anniversary в БД не найдено.");
    await conn.end();
    return;
  }

  console.log("Найдено записей в БД:", rows.length);

  const cols = [
    "title", "series", "country", "face_value", "mint", "mint_short", "metal", "metal_fineness",
    "mintage", "weight_g", "weight_oz", "release_date", "catalog_number", "catalog_suffix", "quality",
    "diameter_mm", "thickness_mm", "length_mm", "width_mm",
    "image_obverse", "image_reverse", "image_box", "image_certificate", "price_display", "source_url",
  ];
  const setClause = cols.map((k) => `${k} = ?`).join(", ");

  let updated = 0;
  for (const row of rows) {
    const canon = matchCanonical(row, canonicals);
    if (!canon) {
      console.log("  [skip] id=" + row.id + " — не удалось сопоставить с каноником");
      continue;
    }
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
      canon.length_mm,
      canon.width_mm,
      canon.image_obverse,
      canon.image_reverse,
      canon.image_box,
      canon.image_certificate,
      canon.price_display,
      canon.source_url,
    ];
    if (dryRun) {
      console.log("  [dry] id=" + row.id + " -> " + canon.title);
      updated++;
      continue;
    }
    await conn.execute(`UPDATE coins SET ${setClause} WHERE id = ?`, [...values, row.id]);
    updated++;
    console.log("  id=" + row.id + " -> " + canon.title);
  }

  await conn.end();
  console.log("\n✓ Обновлено записей:", updated);
  if (updated > 0 && !dryRun) {
    console.log("Дальше: node scripts/export-coins-to-json.js (и сборка), чтобы каталог отобразил изменения.");
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
