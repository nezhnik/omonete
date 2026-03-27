/**
 * Пересчёт weight_g / weight_oz для всех монет mint=PAMP по названию + specs из data/pamp-collectible-*.json.
 * Запуск: node scripts/fix-pamp-weights-from-title.js
 * Дальше: npm run data:export:incremental
 */
require("dotenv").config({ path: ".env" });
const mysql = require("mysql2/promise");
const fs = require("fs");
const path = require("path");
const { derivePampWeight } = require("../lib/pampWeightDerive");

function normalizeUrl(url) {
  if (!url || typeof url !== "string") return null;
  try {
    const u = new URL(url.trim());
    u.hash = "";
    u.search = "";
    return u.toString().replace(/\/+$/, "");
  } catch {
    return String(url).trim().replace(/\/+$/, "") || null;
  }
}

function loadPampSpecsByUrl() {
  const dir = path.join(__dirname, "..", "data");
  const map = new Map();
  for (const f of fs.readdirSync(dir)) {
    if (!f.startsWith("pamp-collectible-") || !f.endsWith(".json") || f.includes("listing-products")) continue;
    let raw;
    try {
      raw = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"));
    } catch {
      continue;
    }
    const u = normalizeUrl(raw.source_url);
    if (u) map.set(u, raw.specs || {});
  }
  return map;
}

function numClose(a, b, eps) {
  if (a == null || b == null) return false;
  const x = Number(String(a).replace(",", "."));
  const y = Number(String(b).replace(",", "."));
  if (!Number.isFinite(x) || !Number.isFinite(y)) return false;
  return Math.abs(x - y) <= eps;
}

function ozClose(dbOz, newOz) {
  if (!dbOz || !newOz) return false;
  const m1 = String(dbOz).match(/(\d+(?:\.\d+)?)/);
  const m2 = String(newOz).match(/(\d+(?:\.\d+)?)/);
  if (!m1 || !m2) return String(dbOz).trim() === String(newOz).trim();
  return Math.abs(Number(m1[1]) - Number(m2[1])) < 0.02;
}

async function main() {
  const url = process.env.DATABASE_URL;
  const m = url.match(/mysql:\/\/([^:]+):([^@]+)@([^:]+):(\d+)\/(.+)/);
  if (!m) throw new Error("DATABASE_URL");
  const [, user, password, host, port, database] = m;
  const conn = await mysql.createConnection({
    host,
    port: Number(port),
    user,
    password,
    database,
    connectTimeout: 20000,
  });

  const specsMap = loadPampSpecsByUrl();
  const [rows] = await conn.execute(
    `SELECT id, title, weight_g, weight_oz, source_url FROM coins WHERE mint = 'PAMP' ORDER BY id`
  );

  let updated = 0;
  let skippedOk = 0;
  const needsReview = [];

  for (const r of rows) {
    const key = normalizeUrl(r.source_url);
    const specs = key && specsMap.has(key) ? specsMap.get(key) : {};
    const w = derivePampWeight(specs, r.title);

    if (w.weightG == null || w.weightOz == null) {
      needsReview.push({ id: r.id, title: r.title, reason: "no_weight_derived" });
      continue;
    }

    const gOk = numClose(r.weight_g, w.weightG, 0.08);
    const ozOk = ozClose(r.weight_oz, w.weightOz);
    if (gOk && ozOk) {
      skippedOk++;
      continue;
    }

    await conn.execute(`UPDATE coins SET weight_g = ?, weight_oz = ? WHERE id = ?`, [
      w.weightG,
      w.weightOz,
      r.id,
    ]);
    console.log(
      `id ${r.id}: ${r.weight_g}g / ${r.weight_oz} → ${w.weightG} g / ${w.weightOz} | ${r.title.slice(0, 60)}`
    );
    updated++;
  }

  await conn.end();
  console.log(`\nГотово: обновлено ${updated}, без изменений ${skippedOk}, нужна ручная проверка ${needsReview.length}`);
  if (needsReview.length) {
    console.log(JSON.stringify(needsReview, null, 2));
  }
  console.log("Дальше: npm run data:export:incremental");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
