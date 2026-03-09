/**
 * Импорт Australian Kookaburra из apmex-kookaburra-parsed.json в БД.
 * Добавляет монеты 1oz, 2oz, 10oz, 1kg с картинками из foreign.
 * Дубликаты по catalog_number и year+weight пропускает.
 *
 * Запуск: node scripts/import-apmex-kookaburra-to-db.js
 */

/* eslint-disable no-console */

require("dotenv").config({ path: ".env" });
const mysql = require("mysql2/promise");
const fs = require("fs");
const path = require("path");

const PARSED_PATH = path.join(__dirname, "..", "data", "apmex-kookaburra-parsed.json");

const WEIGHT_G = { "1oz": 31.1, "2oz": 62.2, "5oz": 155.5, "10oz": 311, "1kg": 1000, "1-10oz": 3.11 };
const FACE_VALUE = { "1oz": "1 доллар", "2oz": "2 доллара", "5oz": "8 долларов", "10oz": "10 долларов", "1kg": "30 долларов", "1-10oz": "1 доллар" };

function getConfig() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL не задан в .env");
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

function toTitle(entry) {
  const w = (entry.weight || "").replace(/\s/g, "");
  const y = entry.year;
  const wLabel = { "1oz": "1 oz", "2oz": "2 oz", "5oz": "5 oz", "10oz": "10 oz", "1kg": "1 кг", "1-10oz": "1/10 oz" }[w] || w;
  return `Australian Kookaburra ${y} ${wLabel} Silver BU`;
}

function toForeignPath(p) {
  if (!p || typeof p !== "string") return p;
  return p.replace("/apmex-kookaburra/apmex-kookaburra-", "/foreign/kookaburra-").replace("/apmex-kookaburra/", "/foreign/");
}

async function main() {
  if (!fs.existsSync(PARSED_PATH)) {
    console.error("Файл не найден:", PARSED_PATH);
    process.exit(1);
  }

  const entries = JSON.parse(fs.readFileSync(PARSED_PATH, "utf8"));
  const withImages = entries.filter((e) => e.obverse && e.reverse);
  console.log("Записей с obv+rev:", withImages.length);

  // Один представитель на year+weight — берём первый (обычно BU)
  const seen = new Map();
  const toImport = [];
  for (const e of withImages) {
    const w = String(e.weight || "").toLowerCase().replace(/[\s-]/g, "");
    const norm = w === "1/10oz" ? "1-10oz" : w;
    const weightG = WEIGHT_G[norm];
    if (!weightG) continue;
    const key = `${e.year}-${norm}`;
    if (seen.has(key)) continue;
    seen.set(key, true);
    toImport.push({ ...e, weightNorm: norm, weightG });
  }
  console.log("Уникальных year+weight для импорта:", toImport.length);

  const conn = await mysql.createConnection(getConfig());

  let hasTitleEn = false;
  try {
    const [cols] = await conn.execute(
      "SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'coins' AND COLUMN_NAME = 'title_en'"
    );
    hasTitleEn = cols.length > 0;
  } catch {
    // ignore
  }

  const colsBase = [
    "title", "title_en", "series", "country", "face_value", "mint", "mint_short",
    "metal", "metal_fineness", "mintage", "weight_g", "weight_oz",
    "release_date", "catalog_number", "quality",
    "image_obverse", "image_reverse"
  ];
  const cols = hasTitleEn ? colsBase : colsBase.filter((k) => k !== "title_en");

  let inserted = 0;
  let skipped = 0;

  for (const e of toImport) {
    const catalogNumber = `AU-KOOK-${e.year}-${e.weightNorm}`;
    const [existing] = await conn.execute(
      "SELECT id FROM coins WHERE catalog_number = ? LIMIT 1",
      [catalogNumber]
    );
    if (existing.length > 0) {
      skipped++;
      continue;
    }

    const faceVal = FACE_VALUE[e.weightNorm] || "1 доллар";
    const weightOz = e.weightNorm === "1kg" ? "32.15" : e.weightNorm === "1-10oz" ? "0.1" : e.weightNorm.replace("oz", "");
    const fineness = e.year >= 2018 ? "9999/10000" : "999/1000";
    const title = toTitle(e);

    const values = [
      title,
      ...(hasTitleEn ? [title] : []),
      "Australian Kookaburra",
      "Австралия",
      faceVal,
      "The Perth Mint",
      "Perth Mint",
      "Серебро",
      fineness,
      1, // mintage: 1 чтобы монета попала в каталог (экспорт отсекает null/0)
      e.weightG,
      weightOz + " унции",
      `${e.year}-01-01`,
      catalogNumber,
      "АЦ",
      toForeignPath(e.obverse),
      toForeignPath(e.reverse)
    ];

    const placeholders = cols.map(() => "?").join(", ");
    await conn.execute(
      `INSERT INTO coins (${cols.join(", ")}) VALUES (${placeholders})`,
      values
    );
    inserted++;
  }

  await conn.end();
  console.log("✓ Kookaburra (APMEX): добавлено", inserted, ", пропущено (уже есть)", skipped);
  if (inserted > 0) {
    console.log("Дальше: npm run data:export:incremental && npm run build");
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
