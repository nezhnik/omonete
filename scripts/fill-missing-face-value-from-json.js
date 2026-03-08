/**
 * Заполняет face_value у монет с пустым номиналом из data/perth-mint-*.json (raw.specs: TVD, AUD, NZD).
 * Совпадение по source_url или catalog_number (Perth). Без --do только выводит список.
 *
 * Запуск:
 *   node scripts/fill-missing-face-value-from-json.js       — показать, что будет обновлено
 *   node scripts/fill-missing-face-value-from-json.js --do   — выполнить UPDATE
 */
require("dotenv").config({ path: ".env" });
const mysql = require("mysql2/promise");
const fs = require("fs");
const path = require("path");
const { formatDenominationForFaceValue } = require("./format-coin-characteristics.js");

const DATA_DIR = path.join(__dirname, "..", "data");

function getConfig() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL не задан");
    process.exit(1);
  }
  const m = url.match(/mysql:\/\/([^:]+):([^@]+)@([^:]+):(\d+)\/(.+)/);
  if (!m) {
    console.error("Неверный формат DATABASE_URL");
    process.exit(1);
  }
  const [, user, password, host, port, database] = m;
  return { host, port: parseInt(port, 10), user, password, database };
}

function getSpecNum(specs, ...keys) {
  for (const k of keys) {
    const v = specs[k];
    if (v != null && String(v).trim() !== "") return parseFloat(String(v).replace(",", "."));
  }
  return null;
}

function faceValueFromSpecs(specs, country) {
  const tvd = getSpecNum(specs, "Monetary Denomination (TVD)");
  const aud = getSpecNum(specs, "Monetary Denomination (AUD)");
  const nzd = getSpecNum(specs, "Monetary Denomination (NZD)");
  const val = country === "Тувалу" ? (tvd ?? aud) : (country === "Niue" ? (nzd ?? aud) : (aud ?? tvd ?? nzd));
  if (val == null) return null;
  return formatDenominationForFaceValue(val, country || "Австралия");
}

async function main() {
  const doUpdate = process.argv.includes("--do");
  const conn = await mysql.createConnection(getConfig());

  const files = fs.readdirSync(DATA_DIR)
    .filter((f) => f.startsWith("perth-mint-") && f.endsWith(".json") && !f.includes("progress") && !f.includes("cache"));
  const jsonByCatalog = new Map();
  const jsonBySourceUrl = new Map();
  for (const f of files) {
    try {
      const data = JSON.parse(fs.readFileSync(path.join(DATA_DIR, f), "utf8"));
      const c = data.coin;
      const raw = data.raw;
      if (!c || !raw || !raw.specs) continue;
      const catalog = (c.catalog_number || "").trim();
      const sourceUrl = (c.source_url || "").trim().replace(/\/+$/, "");
      const fv = faceValueFromSpecs(raw.specs, c.country || "Австралия");
      if (!fv) continue;
      if (catalog) jsonByCatalog.set(catalog, { face_value: fv });
      if (sourceUrl) jsonBySourceUrl.set(sourceUrl, { face_value: fv });
    } catch (e) {
      // skip
    }
  }

  const [rows] = await conn.execute(
    `SELECT id, title, face_value, country, catalog_number, source_url FROM coins
     WHERE (face_value IS NULL OR TRIM(face_value) = '')
     AND (mint LIKE '%Perth%' OR mint_short LIKE '%Perth%')
     ORDER BY id`
  );

  const toUpdate = [];
  for (const r of rows) {
    const sourceUrl = (r.source_url || "").trim().replace(/\/+$/, "");
    const catalog = (r.catalog_number || "").trim();
    const fromUrl = sourceUrl ? jsonBySourceUrl.get(sourceUrl) : null;
    const fromCatalog = catalog ? jsonByCatalog.get(catalog) : null;
    const src = fromUrl || fromCatalog;
    if (src) toUpdate.push({ id: r.id, title: r.title, country: r.country, face_value: src.face_value });
  }

  if (toUpdate.length === 0) {
    console.log("Монет с пустым номиналом, для которых найден номинал в JSON, нет.");
    await conn.end();
    return;
  }
  console.log("Заполнить номинал (из JSON):", toUpdate.length);
  toUpdate.forEach((u) => console.log("  id=" + u.id, u.face_value, "|", (u.title || "").substring(0, 50)));

  if (!doUpdate) {
    console.log("\nДля применения: node scripts/fill-missing-face-value-from-json.js --do");
    await conn.end();
    return;
  }
  let updated = 0;
  for (const u of toUpdate) {
    await conn.execute("UPDATE coins SET face_value = ? WHERE id = ?", [u.face_value, u.id]);
    updated++;
  }
  console.log("\nОбновлено записей:", updated);
  await conn.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
