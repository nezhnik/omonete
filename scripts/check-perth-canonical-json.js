/**
 * Проверка: данные в БД по Perth монетам соответствуют каноническому JSON (с source_url с сайта)?
 * Запуск: node scripts/check-perth-canonical-json.js [id1 id2 ...]
 * Без аргументов — проверяет все Perth; с id — только указанные.
 */
require("dotenv").config({ path: ".env" });
const mysql = require("mysql2/promise");
const fs = require("fs");
const path = require("path");

const DATA_DIR = path.join(__dirname, "..", "data");

function getConfig() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL?");
  const m = url.match(/mysql:\/\/([^:]+):([^@]+)@([^:]+):(\d+)\/(.+)/);
  if (!m) throw new Error("Неверный DATABASE_URL");
  const [, user, password, host, port, database] = m;
  return { host, port: parseInt(port, 10), user, password, database };
}

async function main() {
  const ids = process.argv.slice(2).map((x) => parseInt(x, 10)).filter((n) => !Number.isNaN(n));

  // Собрать по каждому catalog_number список JSON: есть ли канонический (source_url)
  const byCatalog = {};
  if (!fs.existsSync(DATA_DIR)) {
    console.error("Нет папки data/");
    process.exit(1);
  }
  const files = fs.readdirSync(DATA_DIR).filter((f) => f.startsWith("perth-mint-") && f.endsWith(".json"));
  for (const f of files) {
    let raw, c;
    try {
      raw = JSON.parse(fs.readFileSync(path.join(DATA_DIR, f), "utf8"));
      c = raw?.coin;
    } catch {
      continue;
    }
    if (!c) continue;
    const cn = (c.catalog_number && String(c.catalog_number).trim()) || null;
    if (!cn) continue;
    const hasUrl = !!(c.source_url && String(c.source_url).trim() && c.source_url.includes("perthmint.com"));
    if (!byCatalog[cn]) byCatalog[cn] = [];
    byCatalog[cn].push({
      file: f,
      hasUrl,
      country: c.country || null,
      obv: (c.image_obverse || "").trim() || null,
      rev: (c.image_reverse || "").trim() || null,
      title: (c.title || "").trim(),
    });
  }

  const conn = await mysql.createConnection(getConfig());
  let sql = "SELECT id, title, catalog_number, source_url, country, image_obverse, image_reverse FROM coins WHERE (mint LIKE '%Perth%' OR mint_short LIKE '%Perth%')";
  if (ids.length > 0) {
    sql += " AND id IN (" + ids.map(() => "?").join(",") + ")";
  }
  sql += " ORDER BY id";
  const [rows] = ids.length > 0 ? await conn.execute(sql, ids) : await conn.execute(sql);
  await conn.end();

  console.log("Проверка соответствия БД каноническому JSON (файл с source_url с perthmint.com):\n");
  let ok = 0;
  let diff = 0;
  for (const r of rows) {
    const list = byCatalog[r.catalog_number] || [];
    const canon = list.find((x) => x.hasUrl) || list[0];
    const dbObv = (r.image_obverse || "").trim();
    const dbRev = (r.image_reverse || "").trim();
    const dbCountry = (r.country || "").trim();
    const canonObv = canon?.obv || null;
    const canonRev = canon?.rev || null;
    const canonCountry = canon?.country || null;
    const matchCountry = !canonCountry || dbCountry === canonCountry;
    const matchObv = !canonObv || dbObv === canonObv;
    const matchRev = !canonRev || dbRev === canonRev;
    const allMatch = matchCountry && matchObv && matchRev;
    if (allMatch) ok++;
    else diff++;

    const status = allMatch ? "✓" : "≠";
    console.log(`${status} id=${r.id} ${r.catalog_number}`);
    console.log(`   БД: country="${dbCountry}" obv=${dbObv ? dbObv.split("/").pop() : "null"} rev=${dbRev ? dbRev.split("/").pop() : "null"}`);
    if (canon) {
      console.log(`   JSON: ${canon.file} ${canon.hasUrl ? "(canonical)" : "(no source_url)"}`);
      if (!allMatch) {
        if (!matchCountry) console.log(`   → country в canonical: "${canonCountry}"`);
        if (!matchObv) console.log(`   → obv в canonical: ${canonObv ? canonObv.split("/").pop() : "null"}`);
        if (!matchRev) console.log(`   → rev в canonical: ${canonRev ? canonRev.split("/").pop() : "null"}`);
      }
    } else {
      console.log(`   JSON: нет файла с таким catalog_number`);
    }
    console.log("");
  }
  console.log(`Итого: ${ok} совпадают с каноническим, ${diff} отличаются.`);
  if (diff > 0) {
    console.log("\nЧтобы подтянуть данные из канонического JSON: npm run perth:import (импорт уже выбирает файл с source_url при дубликате catalog_number).");
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
