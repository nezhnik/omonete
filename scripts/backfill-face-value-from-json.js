/**
 * Заполняет face_value в БД для монет Perth с пустым номиналом, беря данные из data/perth-mint-*.json (raw.specs: TVD, AUD, NZD).
 * Совпадение по catalog_number. Страна в БД не меняем — для формата номинала используем country из JSON или из БД.
 *
 * Запуск:
 *   node scripts/backfill-face-value-from-json.js       — показать, что будет обновлено
 *   node scripts/backfill-face-value-from-json.js --do   — выполнить UPDATE
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
    if (v != null && String(v).trim() !== "") {
      const n = parseFloat(String(v).replace(",", "."));
      if (!Number.isNaN(n)) return n;
    }
  }
  return null;
}

function countryFromJson(coin) {
  const c = (coin && coin.country) ? String(coin.country).trim() : "";
  const map = { Tuvalu: "Тувалу", Australia: "Австралия", Niue: "Ниуэ", "Cook Islands": "Острова Кука" };
  return map[c] || c;
}

async function main() {
  const doUpdate = process.argv.includes("--do");
  const files = fs.readdirSync(DATA_DIR)
    .filter((f) => f.startsWith("perth-mint-") && f.endsWith(".json") && !f.includes("fetch-progress") && !f.includes("image-url-cache"));

  const jsonByCatalog = new Map();
  for (const f of files) {
    try {
      const data = JSON.parse(fs.readFileSync(path.join(DATA_DIR, f), "utf8"));
      const c = data.coin;
      const raw = data.raw;
      if (!c || !c.catalog_number || !raw || !raw.specs) continue;
      const catalog = String(c.catalog_number).trim();
      const specs = raw.specs;
      const denomTvd = getSpecNum(specs, "Monetary Denomination (TVD)");
      const denomAud = getSpecNum(specs, "Monetary Denomination (AUD)");
      const denomNzd = getSpecNum(specs, "Monetary Denomination (NZD)");
      const country = countryFromJson(c);
      const denom = country === "Тувалу" ? (denomTvd ?? denomAud) : (country === "Ниуэ" ? (denomNzd ?? denomAud) : (denomAud ?? denomTvd ?? denomNzd));
      const faceValue = denom != null && country ? formatDenominationForFaceValue(denom, country) : null;
      if (!faceValue) continue;
      jsonByCatalog.set(catalog, { faceValue, country: c.country });
    } catch (e) {
      // skip
    }
  }

  const conn = await mysql.createConnection(getConfig());
  const [rows] = await conn.execute(
    `SELECT id, title, catalog_number, face_value, country FROM coins
     WHERE (face_value IS NULL OR TRIM(face_value) = '')
     AND (mint LIKE '%Perth%' OR mint_short LIKE '%Perth%')
     AND catalog_number IS NOT NULL AND TRIM(catalog_number) != ''`
  );

  const toUpdate = [];
  for (const r of rows) {
    const cat = String(r.catalog_number).trim();
    const j = jsonByCatalog.get(cat);
    if (j && j.faceValue) toUpdate.push({ id: r.id, title: r.title, face_value: j.faceValue });
  }

  if (toUpdate.length === 0) {
    console.log("Нет монет с пустым номиналом, для которых найден номинал в JSON.");
    await conn.end();
    return;
  }
  console.log("К обновлению (номинал из JSON):", toUpdate.length);
  toUpdate.slice(0, 25).forEach((u) => console.log("  id=" + u.id, u.face_value, "|", (u.title || "").substring(0, 50)));
  if (toUpdate.length > 25) console.log("  ... и ещё", toUpdate.length - 25);

  if (!doUpdate) {
    console.log("\nДля применения: node scripts/backfill-face-value-from-json.js --do");
    await conn.end();
    return;
  }
  for (const u of toUpdate) {
    await conn.execute("UPDATE coins SET face_value = ? WHERE id = ?", [u.face_value, u.id]);
  }
  console.log("\nОбновлено записей:", toUpdate.length);
  await conn.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
