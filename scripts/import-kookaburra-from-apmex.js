/**
 * Импорт Australian Kookaburra в БД по файлам из apmex-kookaburra и данным из KOOKABURRA_SERIES_PLAN.md.
 * Только INSERT — дубликаты (по catalog_number) пропускает.
 *
 * Запуск: node scripts/import-kookaburra-from-apmex.js
 *         node scripts/import-kookaburra-from-apmex.js --dry
 */

/* eslint-disable no-console */

require("dotenv").config({ path: ".env" });
const mysql = require("mysql2/promise");
const fs = require("fs");
const path = require("path");

const KOOKABURRA_DIR = path.join(__dirname, "..", "public", "image", "coins", "kookaburra");
const PLAN_PATH = path.join(
  "/Users/mihail/Desktop/Нумизматика сайт",
  "Файлы и документы по монетам",
  "кукабарра",
  "KOOKABURRA_SERIES_PLAN.md"
);

const WEIGHT_G = { "1oz": 31.1, "2oz": 62.2, "5oz": 155.5, "10oz": 311, "1kg": 1000 };
const FACE_VALUE = { "1oz": "1 доллар", "2oz": "2 доллара", "5oz": "8 долларов", "10oz": "10 долларов", "1kg": "30 долларов" };

// kookaburra-{weight}-{year}-{obv|rev|box|cert}; опционально -proof-, -privy- перед obv|rev
function parseFilename(name) {
  const m = name.match(/^kookaburra-(1oz|2oz|5oz|10oz|1kg)-(\d{4})(?:-[a-z-]+)?-(obv|rev|box|cert)\.(webp|jpeg|jpg)$/i);
  if (!m) return null;
  return { weight: m[1], year: parseInt(m[2], 10), side: m[3], isProof: /proof/i.test(name), isPrivy: /privy|snake/i.test(name) };
}

function scanKookaburra() {
  if (!fs.existsSync(KOOKABURRA_DIR)) return [];
  const files = fs.readdirSync(KOOKABURRA_DIR);
  const byKey = new Map();
  for (const f of files) {
    const p = parseFilename(f);
    if (!p) continue;
    const key = `${p.year}-${p.weight}`;
    if (!byKey.has(key)) byKey.set(key, {});
    const rel = `/image/coins/kookaburra/${f}`;
    if (p.side === "rev" && (p.isProof || p.isPrivy)) {
      if (p.isProof) byKey.get(key).proofRev = rel;
      else byKey.get(key).privyRev = rel;
    } else {
      byKey.get(key)[p.side] = rel;
    }
  }
  const result = [];
  for (const [key, v] of byKey.entries()) {
    const [yearStr, ...wParts] = key.split("-");
    const year = parseInt(yearStr, 10);
    const weight = wParts.join("-");
    const obv = v.obv;
    const rev = v.rev;
    if (obv && rev) {
      result.push({ year, weight, obverse: obv, reverse: rev, box: v.box, cert: v.cert, catalogSuffix: null, quality: "АЦ" });
    }
    if (obv && v.proofRev) {
      result.push({ year, weight, obverse: obv, reverse: v.proofRev, box: v.box, cert: v.cert, catalogSuffix: "P", quality: "Proof" });
    }
    if (obv && v.privyRev) {
      result.push({ year, weight, obverse: obv, reverse: v.privyRev, box: v.box, cert: v.cert, catalogSuffix: "privy", quality: "АЦ" });
    }
  }
  return result;
}

function parsePlan(text) {
  const data = new Map(); // "year-weight" -> { mintage, fineness, type, variant }
  const lines = text.split(/\r?\n/);
  for (const line of lines) {
    if (!line.startsWith("|") || line.startsWith("| year") || line.startsWith("|------")) continue;
    const cells = line.split("|").slice(1, -1).map((c) => c.trim());
    if (cells.length < 13) continue;
    const year = parseInt(cells[0], 10);
    const type = (cells[1] || "").toLowerCase();
    const variant = (cells[2] || "").trim().toLowerCase();
    let weight = null;
    if (/regular-1oz|1oz/i.test(type)) weight = "1oz";
    else if (/regular-2oz|2oz/i.test(type)) weight = "2oz";
    else if (/5oz|proof-5oz|incuse-5oz/i.test(type)) weight = "5oz";
    else if (/regular-10oz|10oz/i.test(type)) weight = "10oz";
    else if (/regular-1kg|1kg/i.test(type)) weight = "1kg";
    if (!year || !weight || variant === "privy") continue;
    const mintageStr = (cells[8] || "").trim().replace(/\s/g, "");
    const mintage = mintageStr ? parseInt(mintageStr, 10) : null;
    const finenessStr = (cells[7] || "").trim();
    const fineness = finenessStr === "0.9999" ? "9999/10000" : "999/1000";
    const key = `${year}-${weight}`;
    if (!data.has(key)) data.set(key, { mintage, fineness, type, variant });
  }
  return data;
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

function toTitle(entry, planRow) {
  const wLabel = { "1oz": "1 oz", "2oz": "2 oz", "5oz": "5 oz", "10oz": "10 oz", "1kg": "1 кг" }[entry.weight] || entry.weight;
  const type = (planRow && planRow.type) || "";
  if (entry.quality === "Proof") return `Australian Kookaburra ${entry.year} ${wLabel} Silver Proof`;
  if (entry.catalogSuffix === "privy") return `Australian Kookaburra ${entry.year} ${wLabel} Silver BU Snake Privy`;
  if (/incuse-5oz|incuse/i.test(type)) return `Australian Kookaburra ${entry.year} ${wLabel} Silver Incused`;
  if (/proof-5oz|proof/i.test(type) || (entry.weight === "5oz" && entry.year <= 2020)) return `Australian Kookaburra ${entry.year} ${wLabel} Silver High Relief`;
  return `Australian Kookaburra ${entry.year} ${wLabel} Silver BU`;
}

async function main() {
  const dryRun = process.argv.includes("--dry");

  const entries = scanKookaburra();
  console.log("Монет с obv+rev из kookaburra:", entries.length);

  let planData = new Map();
  if (fs.existsSync(PLAN_PATH)) {
    planData = parsePlan(fs.readFileSync(PLAN_PATH, "utf8"));
    console.log("Данные из плана:", planData.size, "записей");
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

  let hasImageBox = false;
  try {
    const [boxCol] = await conn.execute(
      "SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'coins' AND COLUMN_NAME = 'image_box'"
    );
    hasImageBox = boxCol.length > 0;
  } catch {
    // ignore
  }

  let hasCatalogSuffix = false;
  try {
    const [cs] = await conn.execute(
      "SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'coins' AND COLUMN_NAME = 'catalog_suffix'"
    );
    hasCatalogSuffix = cs.length > 0;
  } catch { /* ignore */ }

  const colsBase = [
    "title", "title_en", "series", "country", "face_value", "mint", "mint_short",
    "metal", "metal_fineness", "mintage", "weight_g", "weight_oz",
    "release_date", "catalog_number", "quality",
    "image_obverse", "image_reverse",
    ...(hasImageBox ? ["image_box", "image_certificate"] : []),
    ...(hasCatalogSuffix ? ["catalog_suffix"] : [])
  ];
  const cols = hasTitleEn ? colsBase : colsBase.filter((k) => k !== "title_en");

  let inserted = 0;
  let skipped = 0;

  for (const e of entries) {
    const weightNorm = e.weight;
    const baseCatalog = `AU-KOOK-${e.year}-${weightNorm}`;
    const catalogSuffix = e.catalogSuffix || null;
    const catalogNumber = hasCatalogSuffix && catalogSuffix ? baseCatalog : (catalogSuffix ? baseCatalog + "-" + catalogSuffix : baseCatalog);
    const planRow = planData.get(`${e.year}-${weightNorm}`);

    const [existing] = await conn.execute(
      hasCatalogSuffix
        ? "SELECT id FROM coins WHERE catalog_number = ? AND COALESCE(catalog_suffix, '') = COALESCE(?, '') LIMIT 1"
        : "SELECT id FROM coins WHERE catalog_number = ? LIMIT 1",
      hasCatalogSuffix ? [baseCatalog, catalogSuffix] : [catalogNumber]
    );
    if (existing.length > 0) {
      skipped++;
      continue;
    }

    const weightG = WEIGHT_G[weightNorm];
    if (!weightG) continue;

    const faceVal = FACE_VALUE[weightNorm] || "1 доллар";
    const weightOz = weightNorm === "1kg" ? "32.15" : weightNorm.replace("oz", "");
    const fineness = (planRow && planRow.fineness) || (e.year >= 2018 ? "9999/10000" : "999/1000");
    const title = toTitle(e, planRow);
    const mintage = (planRow && planRow.mintage) ?? 1;

    const insertCatalogNumber = hasCatalogSuffix ? baseCatalog : catalogNumber;
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
      insertCatalogNumber,
      e.quality,
      e.obverse,
      e.reverse,
      ...(hasImageBox ? [e.box ?? null, e.cert ?? null] : []),
      ...(hasCatalogSuffix ? [catalogSuffix ?? null] : [])
    ];

    if (!dryRun) {
      const placeholders = cols.map(() => "?").join(", ");
      await conn.execute(
        `INSERT INTO coins (${cols.join(", ")}) VALUES (${placeholders})`,
        values
      );
    }
    inserted++;
    console.log(dryRun ? "  [dry] " : "  + ", catalogNumber + (catalogSuffix ? "-" + catalogSuffix : ""));
  }

  await conn.end();
  console.log("\nГотово.", dryRun ? "(dry run)" : "", "Добавлено:", inserted, ", пропущено:", skipped);
  if (!dryRun && inserted > 0) {
    console.log("Дальше: npm run data:export:incremental && npm run build");
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
