/**
 * Исправляет только монеты из скриншотов пользователя: название и изображения из канонических Perth JSON.
 * Список названий (фрагменты) — те, что были на скриншотах с неправильной картинкой Kookaburra.
 *
 * Запуск: node scripts/fix-coins-from-screenshots.js
 *         node scripts/fix-coins-from-screenshots.js --dry
 */
require("dotenv").config({ path: ".env" });
const mysql = require("mysql2/promise");
const fs = require("fs");
const path = require("path");
const { roundSpec, normalizeWeightG, formatWeightG } = require("./format-coin-characteristics.js");

const DATA_DIR = path.join(__dirname, "..", "data");

// Фрагменты названий с скриншотов (одна картинка у разных монет / отсутствующее изображение)
const TITLE_FRAGMENTS = [
  "Always Together Otter 2020",
  "30th Anniversary Australian Kookaburra 2020 5oz",
  "Australian Kangaroo 2020 Gold Proof Five Coin Set",
  "Perth Money Expo ANDA Special 30th Anniversary Australian Kookaburra 2020",
  "Australian Kangaroo 2019 5oz Silver Proof High Relief",
  "Australian Kangaroo 2019 1/4oz Gold Proof",
  "Australian Wedge-tailed Eagle 2019 5oz Gold Proof High Relief",
  "Australian Wedge-tailed Eagle 2019 2oz Gold Proof High Relief",
  "Australian Wedge-Tailed Eagle 2019 1oz Platinum Proof",
  "50th Anniversary Of The Moon Landing 2019",
  "Australian Kangaroo 2018 2oz Gold Proof High Relief",
  "Australian Kangaroo 2018 1oz Silver Proof High Relief",
  "Australian Wedge-tailed Eagle 2018 5oz Silver Proof High Relief",
  "Australian Koala 2017 1oz Gold Proof High Relief",
  "Australia Half Sovereign 2017 Gold Proof",
  "Australian Koala 2016 1oz Gold Proof High Relief",
  "25th Anniversary Australian Kookaburra 2015 5oz Silver Proof High Relief",
  "25th Anniversary Australian Kookaburra 2015 1oz Silver Proof High Relief",
  "Discover Australia Koala 2013 1oz Silver Proof",
  "2013 Australian Kookaburra Kangaroo Koala High Relief Silver Proof Three Coin Set",
];

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

function loadCanonicals() {
  if (!fs.existsSync(DATA_DIR)) return [];
  const files = fs.readdirSync(DATA_DIR)
    .filter((f) => f.startsWith("perth-mint-") && f.endsWith(".json"))
    .map((f) => path.join(DATA_DIR, f));
  const out = [];
  for (const filePath of files) {
    let raw, c;
    try {
      raw = JSON.parse(fs.readFileSync(filePath, "utf8"));
      c = raw?.coin;
      if (!c) continue;
      if (!(c.source_url && String(c.source_url).trim() && c.source_url.includes("perthmint.com"))) continue;
    } catch {
      continue;
    }
    const saved = raw?.saved;
    const catalogNumber = trim(c.catalog_number) || null;
    const weightG = c.weight_g != null ? normalizeWeightG(Number(c.weight_g)) : null;
    const diameterMm = c.diameter_mm != null ? roundSpec(parseFloat(c.diameter_mm)) : null;
    out.push({
      title: trim(c.title),
      catalog_number: catalogNumber,
      catalog_suffix: trim(c.catalog_suffix) || null,
      source_url: normUrl(c.source_url),
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
      image_obverse: trim(saved?.obverse || c.image_obverse) || null,
      image_reverse: trim(saved?.reverse || c.image_reverse) || null,
      image_box: trim(saved?.box || c.image_box) || null,
      image_certificate: trim(saved?.certificate || c.image_certificate) || null,
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

/** Сопоставление: по source_url, иначе по совпадению названия каноника с названием монеты (нормализованно). */
function findCanonicalForCoin(coin, canonicals) {
  const src = normUrl(coin.source_url);
  if (src) {
    const c = canonicals.find((k) => normUrl(k.source_url) === src);
    if (c) return c;
  }
  const coinTitle = (coin.title || "").toLowerCase().replace(/\s+/g, " ");
  for (const c of canonicals) {
    const canonTitle = (c.title || "").toLowerCase().replace(/\s+/g, " ");
    if (canonTitle === coinTitle) return c;
    if (canonTitle.includes(coinTitle) || coinTitle.includes(canonTitle)) {
      if (Math.abs((canonTitle.length || 0) - (coinTitle.length || 0)) < 30) return c;
    }
  }
  return null;
}

async function main() {
  const dryRun = process.argv.includes("--dry");
  if (dryRun) console.log("Режим --dry: изменения не применяются.\n");

  const canonicals = loadCanonicals();
  if (canonicals.length === 0) {
    console.error("Нет канонических Perth JSON в data/");
    process.exit(1);
  }
  console.log("Каноников Perth:", canonicals.length);

  const conn = await mysql.createConnection(getConfig());

  const placeholders = TITLE_FRAGMENTS.map(() => "title LIKE ?").join(" OR ");
  const params = TITLE_FRAGMENTS.map((f) => "%" + f + "%");

  const [rows] = await conn.execute(
    `SELECT id, title, catalog_number, source_url, metal, weight_g, diameter_mm, thickness_mm, length_mm, width_mm
     FROM coins WHERE (mint LIKE '%Perth%' OR mint_short LIKE '%Perth%') AND (${placeholders})
     ORDER BY id`,
    params
  );

  const seen = new Set();
  const uniq = rows.filter((r) => {
    if (seen.has(r.id)) return false;
    seen.add(r.id);
    return true;
  });

  console.log("Монет по фрагментам названий (из скриншотов):", uniq.length);

  const cols = [
    "title", "series", "country", "face_value", "mint", "mint_short", "metal", "metal_fineness",
    "mintage", "weight_g", "weight_oz", "release_date", "catalog_number", "catalog_suffix", "quality",
    "diameter_mm", "thickness_mm", "length_mm", "width_mm",
    "image_obverse", "image_reverse", "image_box", "image_certificate", "price_display", "source_url",
  ];
  const setClause = cols.map((k) => `${k} = ?`).join(", ");

  let updated = 0;
  let skipped = 0;

  for (const row of uniq) {
    const canon = findCanonicalForCoin(row, canonicals);
    if (!canon) {
      skipped++;
      console.log("  [skip] id=" + row.id + " — нет каноника для «" + (row.title || "").slice(0, 50) + "»");
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
  console.log("\n✓ Обновлено:", updated, ", пропущено (нет каноника):", skipped);
  if (updated > 0 && !dryRun) {
    console.log("Дальше: node scripts/export-coins-to-json.js и npm run build");
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
