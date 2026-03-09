/**
 * Импорт Australian Kookaburra в БД по файлам из foreign.
 * Сканирует public/image/coins/foreign/ на kookaburra-{weight}-{year}-obv.webp / -rev.webp (или apmex-kookaburra-* для совместимости).
 * Только INSERT — дубликаты (по catalog_number) пропускает.
 * mintage: из KOOKABURRA_SERIES_PLAN.md или 1 (чтобы монета попала в каталог).
 *
 * Запуск: node scripts/import-apmex-kookaburra-from-foreign.js
 *         node scripts/import-apmex-kookaburra-from-foreign.js --dry
 */

/* eslint-disable no-console */

require("dotenv").config({ path: ".env" });
const mysql = require("mysql2/promise");
const fs = require("fs");
const path = require("path");

const FOREIGN_DIR = path.join(__dirname, "..", "public", "image", "coins", "foreign");
const PLAN_PATH = path.join(
  "/Users/mihail/Desktop/Нумизматика сайт",
  "Файлы и документы по монетам",
  "кукабарра",
  "KOOKABURRA_SERIES_PLAN.md"
);

const WEIGHT_G = { "1oz": 31.1, "2oz": 62.2, "5oz": 155.5, "10oz": 311, "1kg": 1000 };
const FACE_VALUE = { "1oz": "1 доллар", "2oz": "2 доллара", "5oz": "8 долларов", "10oz": "10 долларов", "1kg": "30 долларов" };

// kookaburra-1oz-1990-obv.webp или apmex-kookaburra-1oz-1990-obv.webp → { weight, year, side }
function parseFilename(name) {
  const m = name.match(/^(?:kookaburra|apmex-kookaburra)-(1oz|2oz|5oz|10oz|1kg)-(\d{4})-(obv|rev)\.webp$/);
  if (!m) return null;
  return { weight: m[1], year: parseInt(m[2], 10), side: m[3] };
}

function scanForeign() {
  if (!fs.existsSync(FOREIGN_DIR)) return [];
  const files = fs.readdirSync(FOREIGN_DIR);
  const byKey = new Map(); // "year-weight" -> { obv, rev }
  for (const f of files) {
    const p = parseFilename(f);
    if (!p) continue;
    const key = `${p.year}-${p.weight}`;
    if (!byKey.has(key)) byKey.set(key, {});
    byKey.get(key)[p.side] = `/image/coins/foreign/${f}`;
  }
  return [...byKey.entries()]
    .filter(([, v]) => v.obv && v.rev)
    .map(([key, v]) => {
      const parts = key.split("-");
      const year = parseInt(parts[0], 10);
      const weight = parts.slice(1).join("-"); // "1kg" or "1oz"
      return { year, weight, obverse: v.obv, reverse: v.rev };
    });
}

function parseMintageFromPlan(text) {
  const m = new Map(); // "year-weight" -> mintage
  const lines = text.split(/\r?\n/);
  for (const line of lines) {
    if (!line.startsWith("|") || line.startsWith("| year") || line.startsWith("|------")) continue;
    const cells = line.split("|").slice(1, -1).map((c) => c.trim());
    if (cells.length < 10) continue;
    const year = parseInt(cells[0], 10);
    const type = (cells[1] || "").toLowerCase();
    let weight = null;
    if (/regular-1oz|1oz/i.test(type)) weight = "1oz";
    else if (/regular-2oz|2oz/i.test(type)) weight = "2oz";
    else if (/5oz|proof-5oz|incuse-5oz/i.test(type)) weight = "5oz";
    else if (/regular-10oz|10oz/i.test(type)) weight = "10oz";
    else if (/regular-1kg|1kg/i.test(type)) weight = "1kg";
    if (!year || !weight) continue;
    const mintageStr = (cells[8] || "").trim().replace(/\s/g, "");
    const mintage = mintageStr ? parseInt(mintageStr, 10) : null;
    if (mintage != null && !Number.isNaN(mintage)) {
      m.set(`${year}-${weight}`, mintage);
    }
  }
  return m;
}

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
  const wn = entry.weight === "1kg" ? "1kg" : (entry.weight || "").replace(/oz$/, "");
  const wLabel = { "1oz": "1 oz", "2oz": "2 oz", "5oz": "5 oz", "10oz": "10 oz", "1kg": "1 кг" }[entry.weight] || `${wn} oz`;
  return `Australian Kookaburra ${entry.year} ${wLabel} Silver BU`;
}

async function main() {
  const dryRun = process.argv.includes("--dry");

  const entries = scanForeign();
  console.log("Монет с obv+rev из foreign (apmex-kookaburra-*):", entries.length);

  let mintageMap = new Map();
  if (fs.existsSync(PLAN_PATH)) {
    const planText = fs.readFileSync(PLAN_PATH, "utf8");
    mintageMap = parseMintageFromPlan(planText);
    console.log("Mintage из плана:", mintageMap.size, "записей");
  }

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

  for (const e of entries) {
    const weightNorm = e.weight === "1kg" ? "1kg" : e.weight.replace("oz", "") + "oz";
    const catalogNumber = `AU-KOOK-${e.year}-${weightNorm}`;

    const [existing] = await conn.execute(
      "SELECT id FROM coins WHERE catalog_number = ? LIMIT 1",
      [catalogNumber]
    );
    if (existing.length > 0) {
      skipped++;
      continue;
    }

    const weightG = WEIGHT_G[weightNorm];
    if (!weightG) continue;

    const faceVal = FACE_VALUE[weightNorm] || "1 доллар";
    const weightOz = weightNorm === "1kg" ? "32.15" : weightNorm.replace("oz", "");
    const fineness = e.year >= 2018 ? "9999/10000" : "999/1000";
    const title = toTitle(e);
    const mintageKey = `${e.year}-${weightNorm}`;
    const mintage = mintageMap.get(mintageKey) ?? 1;

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
      mintage,
      weightG,
      weightOz + " унции",
      `${e.year}-01-01`,
      catalogNumber,
      "АЦ",
      e.obverse,
      e.reverse
    ];

    if (!dryRun) {
      const placeholders = cols.map(() => "?").join(", ");
      await conn.execute(
        `INSERT INTO coins (${cols.join(", ")}) VALUES (${placeholders})`,
        values
      );
    }
    inserted++;
    console.log(dryRun ? "  [dry] " : "  + ", catalogNumber, e.obverse);
  }

  await conn.end();
  console.log("\nГотово.", dryRun ? "(dry run)" : "", "Добавлено:", inserted, ", пропущено (уже есть):", skipped);
  if (!dryRun && inserted > 0) {
    console.log("Дальше: npm run data:export:incremental && npm run build");
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
