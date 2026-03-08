/**
 * Восстановление Perth-монет, перезаписанных одним каноником из-за совпадения catalog_number.
 * Каноники: по одному на каждый файл с source_url (не по catalog_number), чтобы различать разные продукты.
 * Сопоставление: по source_url, затем по catalog_number (если у каноника он единственный), затем по metal + weight_g + diameter_mm + thickness_mm.
 * Изображения берутся из raw.saved при наличии. Обновляет title, catalog_number, source_url, картинки и остальные поля.
 *
 * Запуск:
 *   node scripts/fix-perth-overwritten-coins.js       — восстановить БД
 *   node scripts/fix-perth-overwritten-coins.js --dry  — только показать, что изменится
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

/** Загружаем все канонические Perth JSON: по одному на файл с source_url (не по catalog_number), чтобы восстановить перезаписанные монеты по metal+weight+diameter */
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
      const hasSourceUrl = !!(c.source_url && String(c.source_url).trim() && c.source_url.includes("perthmint.com"));
      if (!hasSourceUrl) continue;
    } catch {
      continue;
    }
    const catalogNumber = trim(c.catalog_number) || null;
    const sourceUrl = normUrl(c.source_url);
    const weightG = c.weight_g != null ? normalizeWeightG(Number(c.weight_g)) : null;
    const diameterMm = c.diameter_mm != null ? roundSpec(parseFloat(c.diameter_mm)) : null;
    const saved = raw?.saved;
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

/** Заголовок, которым перезаписали много разных монет (Kookaburra) — для таких не доверяем source_url, сопоставляем по спекам */
const OVERWRITTEN_TITLE_PATTERN = "Perth Stamp and Coin Show Special Kookaburra 2026 1oz Silver Gold-Plated Coin in Card";

function isOverwrittenTitle(title) {
  return title && String(title).trim() === OVERWRITTEN_TITLE_PATTERN;
}

/**
 * Сопоставить строку БД с каноником: по source_url (если запись не с перезаписанным заголовком), catalog_number (если один), или по metal + diameter_mm + thickness_mm + length_mm + width_mm.
 * weight_g при сопоставлении по спекам не используем — при перезаписи он мог быть подставлен общий (31.1).
 */
function matchCanonical(row, canonicals, usedCanonUrls) {
  const rowTitle = trim(row.title);
  const skipSourceUrl = isOverwrittenTitle(rowTitle);

  if (!skipSourceUrl) {
    const src = normUrl(row.source_url);
    if (src) {
      const c = canonicals.find((k) => normUrl(k.source_url) === src);
      if (c) return c;
    }
  }
  const cat = trim(row.catalog_number);
  if (cat && !skipSourceUrl) {
    const byCat = canonicals.filter((k) => trim(k.catalog_number) === cat);
    if (byCat.length === 1) return byCat[0];
  }
  const metal = trim(row.metal);
  const d = row.diameter_mm != null ? roundSpec(parseFloat(String(row.diameter_mm).replace(",", "."))) : null;
  const t = row.thickness_mm != null ? roundSpec(parseFloat(String(row.thickness_mm).replace(",", "."))) : null;
  const len = row.length_mm != null ? roundSpec(parseFloat(String(row.length_mm).replace(",", "."))) : null;
  const wid = row.width_mm != null ? roundSpec(parseFloat(String(row.width_mm).replace(",", "."))) : null;
  if (d == null && t == null && len == null && wid == null) return null;
  const candidates = [];
  for (const c of canonicals) {
    if (trim(c.metal) !== metal) continue;
    const cD = c.diameter_mm != null ? roundSpec(c.diameter_mm) : null;
    const cT = c.thickness_mm != null ? roundSpec(parseFloat(c.thickness_mm)) : null;
    const cLen = c.length_mm != null ? roundSpec(parseFloat(c.length_mm)) : null;
    const cWid = c.width_mm != null ? roundSpec(parseFloat(c.width_mm)) : null;
    const dMatch = (cD == null && d == null) || (cD != null && d != null && Math.abs(cD - d) < 1);
    const tMatch = (cT == null && t == null) || (cT != null && t != null && Math.abs(cT - t) < 0.5);
    const lenMatch = (cLen == null && len == null) || (cLen != null && len != null && Math.abs(cLen - len) < 0.5);
    const widMatch = (cWid == null && wid == null) || (cWid != null && wid != null && Math.abs(cWid - wid) < 0.5);
    if (dMatch && tMatch && lenMatch && widMatch) candidates.push(c);
  }
  if (candidates.length === 0) return null;
  if (candidates.length === 1) {
    if (skipSourceUrl && usedCanonUrls && candidates[0].source_url && usedCanonUrls.has(candidates[0].source_url)) return null;
    return candidates[0];
  }
  const w = row.weight_g != null ? normalizeWeightG(parseFloat(String(row.weight_g).replace(",", "."))) : null;
  if (w != null) {
    const byWeight = candidates.filter((c) => {
      const cW = c.weight_g != null ? normalizeWeightG(c.weight_g) : null;
      return cW != null && Math.abs(cW - w) < 1;
    });
    if (byWeight.length === 1) {
      if (skipSourceUrl && usedCanonUrls && byWeight[0].source_url && usedCanonUrls.has(byWeight[0].source_url)) return null;
      return byWeight[0];
    }
  }
  if (skipSourceUrl && usedCanonUrls) {
    const unused = candidates.find((c) => c.source_url && !usedCanonUrls.has(c.source_url));
    if (unused) return unused;
    return null;
  }
  return candidates[0];
}

async function main() {
  const dryRun = process.argv.includes("--dry");
  if (dryRun) console.log("Режим --dry: изменения не применяются.\n");

  const canonicals = loadCanonicals();
  if (canonicals.length === 0) {
    console.error("Нет канонических Perth JSON в data/");
    process.exit(1);
  }
  console.log("Каноников Perth (по одному на файл с source_url):", canonicals.length);

  const conn = await mysql.createConnection(getConfig());
  const [rows] = await conn.execute(
    `SELECT id, title, catalog_number, source_url, metal, weight_g, diameter_mm, thickness_mm, length_mm, width_mm, mint, mint_short
     FROM coins WHERE (mint LIKE '%Perth%' OR mint_short LIKE '%Perth%') ORDER BY id`
  );

  if (rows.length === 0) {
    console.log("Записей Perth в БД не найдено.");
    await conn.end();
    return;
  }

  console.log("Записей Perth в БД:", rows.length);

  const cols = [
    "title", "series", "country", "face_value", "mint", "mint_short", "metal", "metal_fineness",
    "mintage", "weight_g", "weight_oz", "release_date", "catalog_number", "catalog_suffix", "quality",
    "diameter_mm", "thickness_mm", "length_mm", "width_mm",
    "image_obverse", "image_reverse", "image_box", "image_certificate", "price_display", "source_url",
  ];
  const setClause = cols.map((k) => `${k} = ?`).join(", ");

  let updated = 0;
  let skipped = 0;
  /** Для записей с перезаписанным заголовком — один каноник на одну запись (по source_url) */
  const usedCanonUrls = new Set();
  for (const row of rows) {
    const useOnce = isOverwrittenTitle(trim(row.title));
    const canon = matchCanonical(row, canonicals, useOnce ? usedCanonUrls : null);
    if (!canon) {
      skipped++;
      if (skipped <= 5) console.log("  [skip] id=" + row.id + " — нет подходящего каноника (metal/weight/diameter)");
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
    if (useOnce && canon.source_url) usedCanonUrls.add(canon.source_url);
    if (dryRun) {
      console.log("  [dry] id=" + row.id + " -> " + canon.title);
      updated++;
      continue;
    }
    await conn.execute(`UPDATE coins SET ${setClause} WHERE id = ?`, [...values, row.id]);
    updated++;
    if (updated <= 30) console.log("  id=" + row.id + " -> " + canon.title);
  }

  if (skipped > 0) console.log("  ... пропущено (нет каноника по спекам):", skipped);
  await conn.end();
  console.log("\n✓ Обновлено записей:", updated);
  if (updated > 0 && !dryRun) {
    console.log("Дальше: node scripts/update-perth-from-canonical-json.js (при необходимости), затем node scripts/export-coins-to-json.js и сборка.");
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
