/**
 * Записывает в data/austrian-mint-*.json поле mintage_sync из БД (по source_url),
 * чтобы import-austrian-mint-to-db.js не затирал тиражи пустыми specs с сайта.
 *
 *   node scripts/sync-austrian-mintage-json-from-db.js
 */
require("dotenv").config({ path: ".env" });
const mysql = require("mysql2/promise");
const fs = require("fs");
const path = require("path");

const DATA_DIR = path.join(__dirname, "..", "data");

function getConfig() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL не задан");
  const m = url.match(/mysql:\/\/([^:]+):([^@]+)@([^:]+):(\d+)\/(.+)/);
  if (!m) throw new Error("Неверный формат DATABASE_URL");
  const [, user, password, host, port, database] = m;
  return { host, port: Number(port), user, password, database };
}

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

async function main() {
  const cfg = getConfig();
  const conn = await mysql.createConnection(cfg);
  const [rows] = await conn.execute(
    `SELECT source_url, mintage, mintage_display FROM coins
     WHERE country = 'Австрия' AND source_url LIKE '%muenzeoesterreich%'`
  );
  await conn.end();

  const byUrl = new Map();
  for (const r of rows) {
    const k = normalizeUrl(r.source_url);
    if (k) byUrl.set(k, r);
  }

  const files = fs
    .readdirSync(DATA_DIR)
    .filter((f) => f.startsWith("austrian-mint-") && f.endsWith(".json") && !f.includes("listing-products"));

  let updated = 0;
  let missingDb = 0;
  for (const f of files) {
    const fp = path.join(DATA_DIR, f);
    let raw;
    try {
      raw = JSON.parse(fs.readFileSync(fp, "utf8"));
    } catch {
      continue;
    }
    const su = normalizeUrl(raw.source_url);
    if (!su || !/muenzeoesterreich\.com/i.test(su)) continue;
    const row = byUrl.get(su);
    if (!row) {
      missingDb++;
      continue;
    }
    const m =
      row.mintage != null && Number(row.mintage) !== 0 && Number.isFinite(Number(row.mintage))
        ? Number(row.mintage)
        : null;
    const d = row.mintage_display != null && String(row.mintage_display).trim() ? String(row.mintage_display).trim() : null;
    raw.mintage_sync = { mintage: m, mintage_display: d };
    fs.writeFileSync(fp, JSON.stringify(raw, null, 2) + "\n");
    updated++;
  }

  console.log("JSON файлов обработано:", files.length);
  console.log("Записано mintage_sync:", updated);
  if (missingDb) console.log("Нет строки в БД по source_url:", missingDb);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
