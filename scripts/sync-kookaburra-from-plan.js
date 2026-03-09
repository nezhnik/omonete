/**
 * Синхронизация характеристик AU-KOOK монет из KOOKABURRA_SERIES_PLAN.md.
 * Обновляет: face_value, metal_fineness, mintage (только BU), weight_g, weight_oz,
 *            diameter_mm, thickness_mm (по стандартам Perth Mint для каждого веса).
 *
 * Монеты с source_url = perthmint.com НЕ трогаем (данные с Perth Mint считаются каноническими).
 * Обновляются только монеты из плана: APMEX, Chards, foreign, privy, proof.
 *
 * Запуск: node scripts/sync-kookaburra-from-plan.js
 *         node scripts/sync-kookaburra-from-plan.js --dry
 */

/* eslint-disable no-console */

require("dotenv").config({ path: ".env" });
const fs = require("fs");
const path = require("path");
const mysql = require("mysql2/promise");

const PLAN_PATH = path.join(
  "/Users/mihail/Desktop/Нумизматика сайт",
  "Файлы и документы по монетам",
  "кукабарра",
  "KOOKABURRA_SERIES_PLAN.md"
);

const FACE = { "1oz": "1 доллар", "2oz": "2 доллара", "10oz": "10 долларов", "1kg": "30 долларов", "5oz": "8 долларов" };
const WEIGHT_G = { "1oz": "31.1", "2oz": "62.2", "10oz": "311", "1kg": "1000", "5oz": "155.5" };
const WEIGHT_OZ = { "1oz": "1", "2oz": "2", "10oz": "10", "1kg": "32.15", "5oz": "5" };
// Стандарты Perth Mint: diameter_mm, thickness_mm по весу (1oz: 40.6/4; 2oz: bullion; 10oz,1kg,5oz: Perth Mint)
const DIAMETER_MM = { "1oz": "40.6", "2oz": "50.3", "10oz": "75.9", "1kg": "100.9", "5oz": "50.6" };
const THICKNESS_MM = { "1oz": "4", "2oz": "4.5", "10oz": "8.66", "1kg": "14.5", "5oz": "12.5" };

function parseTable(text, weightKey, faceVal) {
  const rows = [];
  const lines = text.split(/\r?\n/);
  for (const line of lines) {
    if (!line.startsWith("|") || line.startsWith("| year") || line.startsWith("|------")) continue;
    const cells = line.split("|").slice(1, -1).map((c) => c.trim());
    if (cells.length < 10) continue;
    const year = parseInt(cells[0], 10);
    const type = (cells[1] || "").toLowerCase();
    const variant = (cells[2] || "").trim().toLowerCase();
    const finenessStr = (cells[6] || "").trim(); // fineness колонка
    const fineness = finenessStr === "0.9999" ? "9999/10000" : "999/1000";
    const mintageStr = (cells[8] || "").trim().replace(/\s/g, "");
    const mintage = mintageStr ? parseInt(mintageStr, 10) : null;
    if (!year) continue;
    rows.push({
      year,
      weight: weightKey,
      variant: variant || "regular",
      face_value: faceVal,
      fineness,
      mintage,
      weight_g: WEIGHT_G[weightKey],
      weight_oz: WEIGHT_OZ[weightKey],
    });
  }
  return rows;
}

function parsePlan(text) {
  const map = new Map();
  const sections = text.split(/^## /m);
  for (const sec of sections) {
    if (sec.includes("Regular (1 oz")) {
      parseTable(sec, "1oz", "1 доллар").forEach((r) => map.set(`${r.year}-1oz`, r));
    } else if (sec.includes("Regular (2 oz")) {
      parseTable(sec, "2oz", "2 доллара").forEach((r) => map.set(`${r.year}-2oz`, r));
    } else if (sec.includes("Regular (10 oz")) {
      parseTable(sec, "10oz", "10 долларов").forEach((r) => map.set(`${r.year}-10oz`, r));
    } else if (sec.includes("Regular (1 kg")) {
      parseTable(sec, "1kg", "30 долларов").forEach((r) => map.set(`${r.year}-1kg`, r));
    } else if (sec.includes("5 oz Silver")) {
      parseTable(sec, "5oz", "8 долларов").forEach((r) => map.set(`${r.year}-5oz`, r));
    }
  }
  return map;
}

function parseCatalog(catalogNumber, catalogSuffix) {
  const m = catalogNumber.match(/^AU-KOOK-(\d{4})-?(.*)$/);
  if (!m) return null;
  const year = parseInt(m[1], 10);
  const suf = (m[2] || "").toUpperCase();
  const suffix = (catalogSuffix || "").trim();
  let weight = "1oz";
  if (/^B$/.test(suf) || /^1OZ$/.test(suf) || (suf === "" && !suffix)) weight = "1oz";
  else if (/^P$/.test(suf) || /^1OZ\s+P$/i.test(suf + suffix)) weight = "1oz";
  else if (/^2OZ$/i.test(suf)) weight = "2oz";
  else if (/^10OZ$/i.test(suf)) weight = "10oz";
  else if (/^1KG$/i.test(suf)) weight = "1kg";
  else if (/^5OZ$/i.test(suf)) weight = "5oz";
  else weight = "1oz";
  const isProof = /^P$/i.test(suf) || /proof|P$/i.test(suffix);
  const isPrivy = /privy/i.test(suf + suffix);
  return { year, weight, isProof, isPrivy };
}

async function main() {
  const dryRun = process.argv.includes("--dry");
  const planText = fs.readFileSync(PLAN_PATH, "utf8");
  const plan = parsePlan(planText);
  console.log("Записей в плане:", plan.size);

  const url = process.env.DATABASE_URL;
  const m = url.match(/mysql:\/\/([^:]+):([^@]+)@([^:]+):(\d+)\/(.+)/);
  const conn = await mysql.createConnection({
    host: m[3], port: parseInt(m[4], 10), user: m[1], password: m[2], database: m[5],
  });

  const [rows] = await conn.execute(
    `SELECT id, catalog_number, catalog_suffix, source_url, face_value, metal_fineness, mintage, weight_g, weight_oz, diameter_mm, thickness_mm, quality
     FROM coins WHERE series = 'Australian Kookaburra' AND catalog_number LIKE 'AU-KOOK-%'`
  );

  let updated = 0;
  let skippedPerth = 0;
  const fixes = [];

  for (const r of rows) {
    // Монеты с Perth Mint не трогаем — данные от монетного двора считаются каноническими
    const src = (r.source_url || "").trim();
    if (src.includes("perthmint.com")) {
      skippedPerth++;
      continue;
    }

    const parsed = parseCatalog(r.catalog_number, r.catalog_suffix);
    if (!parsed) continue;
    const key = `${parsed.year}-${parsed.weight}`;
    const planRow = plan.get(key);

    const updates = {};
    if (planRow) {
      const fv = planRow.face_value;
      if (fv && String(r.face_value || "").trim() !== fv) updates.face_value = fv;
      if (planRow.fineness && String(r.metal_fineness || "").trim() !== planRow.fineness) updates.metal_fineness = planRow.fineness;
      if (planRow.weight_g && String(r.weight_g || "").replace(",", ".") !== planRow.weight_g) updates.weight_g = planRow.weight_g;
      if (planRow.weight_oz && String(r.weight_oz || "").replace(",", ".") !== planRow.weight_oz) updates.weight_oz = planRow.weight_oz;
      if (!parsed.isProof && planRow.mintage != null && r.mintage !== planRow.mintage) updates.mintage = planRow.mintage;
    }

    // diameter_mm, thickness_mm по стандартам для веса (для всех AU-KOOK, в т.ч. без записи в плане)
    const stdDiam = DIAMETER_MM[parsed.weight];
    const stdThick = THICKNESS_MM[parsed.weight];
    if (stdDiam) {
      const curDiam = String(r.diameter_mm ?? "").replace(",", ".").trim();
      if (curDiam !== stdDiam) updates.diameter_mm = stdDiam;
    }
    if (stdThick) {
      const curThick = String(r.thickness_mm ?? "").replace(",", ".").trim();
      if (curThick !== stdThick) updates.thickness_mm = stdThick;
    }

    if (Object.keys(updates).length === 0) continue;

    fixes.push({ id: r.id, catalog: r.catalog_number + (r.catalog_suffix ? "-" + r.catalog_suffix : ""), updates });
    if (!dryRun) {
      const sets = Object.entries(updates).map(([k, v]) => `${k} = ?`).join(", ");
      const vals = Object.values(updates);
      await conn.execute(`UPDATE coins SET ${sets} WHERE id = ?`, [...vals, r.id]);
    }
    updated++;
  }

  for (const f of fixes) {
    console.log("id=" + f.id, f.catalog, "->", f.updates);
  }
  if (skippedPerth) console.log("\nПропущено (source_url = perthmint.com):", skippedPerth);
  console.log((dryRun ? "[dry] " : "") + "Обновлено записей:", updated);
  await conn.end();
}

main().catch((e) => { console.error(e); process.exit(1); });
