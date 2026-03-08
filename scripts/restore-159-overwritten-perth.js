/**
 * Восстановление 159 перезаписанных монет: 1 строка = правильная Kookaburra, остальные 158
 * восстанавливаем по catalog_number в БД (он не перезаписывался при update-perth).
 * Правило: 1 URL = 1 строка. Одна запись остаётся Kookaburra, у остальных подставляем каноник по catalog_number.
 *
 * Запуск: node scripts/restore-159-overwritten-perth.js
 *         node scripts/restore-159-overwritten-perth.js --dry
 */
require("dotenv").config({ path: ".env" });
const mysql = require("mysql2/promise");
const fs = require("fs");
const path = require("path");
const { roundSpec, normalizeWeightG, formatWeightG } = require("./format-coin-characteristics.js");

const DATA_DIR = path.join(__dirname, "..", "data");
const OVERWRITTEN_TITLE = "Perth Stamp and Coin Show Special Kookaburra 2026 1oz Silver Gold-Plated Coin in Card";

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

/** Загружаем каноники (как в fix-perth): по одному на файл с source_url */
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

async function main() {
  const dryRun = process.argv.includes("--dry");
  if (dryRun) console.log("Режим --dry: изменения не применяются.\n");

  const canonicals = loadCanonicals();
  const kookaburraCanon = canonicals.find((k) => trim(k.title) === OVERWRITTEN_TITLE);
  const kookaburraUrl = kookaburraCanon ? kookaburraCanon.source_url : null;

  // catalog_number -> массив каноников (несколько продуктов могут иметь один SKU)
  const byCatalog = new Map();
  for (const c of canonicals) {
    const cn = trim(c.catalog_number);
    if (!cn) continue;
    if (!byCatalog.has(cn)) byCatalog.set(cn, []);
    byCatalog.get(cn).push(c);
  }

  const conn = await mysql.createConnection(getConfig());
  const [rows] = await conn.execute(
    `SELECT id, title, catalog_number, source_url, metal, weight_g, diameter_mm, thickness_mm, length_mm, width_mm
     FROM coins
     WHERE (mint LIKE '%Perth%' OR mint_short LIKE '%Perth%') AND title = ?
     ORDER BY id`,
    [OVERWRITTEN_TITLE]
  );

  if (rows.length === 0) {
    console.log("Записей с перезаписанным заголовком не найдено.");
    await conn.end();
    return;
  }

  console.log("Найдено записей с заголовком Kookaburra:", rows.length);
  console.log("Оставляем одну (id=" + rows[0].id + ") как правильную Kookaburra, остальные восстанавливаем по catalog_number.\n");

  const cols = [
    "title", "series", "country", "face_value", "mint", "mint_short", "metal", "metal_fineness",
    "mintage", "weight_g", "weight_oz", "release_date", "catalog_number", "catalog_suffix", "quality",
    "diameter_mm", "thickness_mm", "length_mm", "width_mm",
    "image_obverse", "image_reverse", "image_box", "image_certificate", "price_display", "source_url",
  ];
  const setClause = cols.map((k) => `${k} = ?`).join(", ");
  const usedCanonUrls = new Set();
  if (kookaburraUrl) usedCanonUrls.add(kookaburraUrl);

  let restored = 0;
  let skipped = 0;
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (i === 0) {
      if (!dryRun) {
        if (kookaburraCanon) {
          const weightGForDb = kookaburraCanon.weight_g != null ? (formatWeightG(kookaburraCanon.weight_g) ?? String(kookaburraCanon.weight_g)) : null;
          const values = [
            kookaburraCanon.title, kookaburraCanon.series, kookaburraCanon.country, kookaburraCanon.face_value,
            kookaburraCanon.mint, kookaburraCanon.mint_short, kookaburraCanon.metal, kookaburraCanon.metal_fineness,
            kookaburraCanon.mintage, weightGForDb, kookaburraCanon.weight_oz, kookaburraCanon.release_date,
            kookaburraCanon.catalog_number, kookaburraCanon.catalog_suffix, kookaburraCanon.quality,
            kookaburraCanon.diameter_mm, kookaburraCanon.thickness_mm, kookaburraCanon.length_mm, kookaburraCanon.width_mm,
            kookaburraCanon.image_obverse, kookaburraCanon.image_reverse, kookaburraCanon.image_box, kookaburraCanon.image_certificate,
            kookaburraCanon.price_display, kookaburraCanon.source_url, row.id,
          ];
          await conn.execute(`UPDATE coins SET ${setClause} WHERE id = ?`, values);
        }
      }
      continue;
    }

    const dbCatalog = trim(row.catalog_number);
    const candidates = dbCatalog ? (byCatalog.get(dbCatalog) || []) : [];
    const notKookaburra = candidates.filter((c) => c.source_url !== kookaburraUrl);
    const unused = notKookaburra.filter((c) => c.source_url && !usedCanonUrls.has(c.source_url));
    const canon = unused.length > 0 ? unused[0] : (notKookaburra.length > 0 ? notKookaburra[0] : null);

    if (!canon) {
      skipped++;
      if (skipped <= 10) console.log("  [пропуск] id=" + row.id + " catalog_number=" + dbCatalog + " — нет однозначного каноника");
      continue;
    }

    if (canon.source_url) usedCanonUrls.add(canon.source_url);
    const weightGForDb = canon.weight_g != null ? (formatWeightG(canon.weight_g) ?? String(canon.weight_g)) : null;
    const values = [
      canon.title, canon.series, canon.country, canon.face_value,
      canon.mint, canon.mint_short, canon.metal, canon.metal_fineness,
      canon.mintage, weightGForDb, canon.weight_oz, canon.release_date,
      canon.catalog_number, canon.catalog_suffix, canon.quality,
      canon.diameter_mm, canon.thickness_mm, canon.length_mm, canon.width_mm,
      canon.image_obverse, canon.image_reverse, canon.image_box, canon.image_certificate,
      canon.price_display, canon.source_url, row.id,
    ];

    if (dryRun) {
      console.log("  [dry] id=" + row.id + " catalog=" + dbCatalog + " -> " + (canon.title || "").slice(0, 50));
    } else {
      await conn.execute(`UPDATE coins SET ${setClause} WHERE id = ?`, values);
      if (restored < 20) console.log("  id=" + row.id + " -> " + (canon.title || "").slice(0, 50));
    }
    restored++;
  }

  if (skipped > 0) console.log("  ... пропущено (нет каноника по catalog_number):", skipped);
  await conn.end();
  console.log("\n✓ Восстановлено записей:", restored);
  if (restored > 0 && !dryRun) {
    console.log("Дальше: npm run data:export:incremental && npm run build");
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
