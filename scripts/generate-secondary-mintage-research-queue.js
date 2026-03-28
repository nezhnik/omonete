/**
 * Очередь для поиска тиража во вторичных источниках (без HTTP к каталогам).
 * Пишет data/secondary-mintage-research-queue.json: id, поля монеты, готовые URL поиска.
 *
 * Когорта по умолчанию — как backfill-foreign-mintage-empty-cohort.js (пустой mintage_display).
 * Флаг --include-unknown-display — добавить строки с «Тираж не указан» (coinNeedsMintageResearch).
 *
 *   node scripts/generate-secondary-mintage-research-queue.js
 *   node scripts/generate-secondary-mintage-research-queue.js --limit 100
 *   node scripts/generate-secondary-mintage-research-queue.js --include-unknown-display
 */
require("dotenv").config({ path: ".env" });
const mysql = require("mysql2/promise");
const fs = require("fs");
const path = require("path");
const { MINTAGE_UNKNOWN_DISPLAY, coinNeedsMintageResearch } = require("./parsing-mintage-constants.js");

const OUT_JSON = path.join(__dirname, "..", "data", "secondary-mintage-research-queue.json");

function getConfig() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL не задан");
  const m = url.match(/mysql:\/\/([^:]+):([^@]+)@([^:]+):(\d+)\/(.+)/);
  if (!m) throw new Error("Неверный формат DATABASE_URL");
  const [, user, password, host, port, database] = m;
  return { host, port: Number(port), user, password, database };
}

function catalogPrefix(cat) {
  const s = String(cat || "");
  if (/^GB-ROYAL-/i.test(s)) return "GB-ROYAL";
  if (/^CH-PAMP-/i.test(s)) return "CH-PAMP";
  if (/^PL-MENNICA-GOLD-BAR-/i.test(s)) return "PL-MENNICA-GOLD-BAR";
  if (/^DE-GERMANIA-/i.test(s)) return "DE-GERMANIA";
  if (/^AU-PERTH-/i.test(s)) return "AU-PERTH";
  if (/^AT-/i.test(s)) return "AT";
  return "OTHER";
}

function buildSearchUrls(row) {
  const title = String(row.title_en || row.title || "").trim();
  const country = String(row.country || "").trim();
  const cat = String(row.catalog_number || "").trim();
  const qBase = [country, title].filter(Boolean).join(" ").trim() || title || cat;
  const qShort = qBase.slice(0, 160);

  const enc = (s) => encodeURIComponent(s);
  return {
    numista: `https://en.numista.com/catalogue/index.php?q=${enc(qShort)}`,
    googleNumista: `https://www.google.com/search?q=${enc(`site:numista.com ${qShort}`)}`,
    googleColnect: `https://www.google.com/search?q=${enc(`site:colnect.com ${qShort}`)}`,
    googleGeneral: `https://www.google.com/search?q=${enc(`${qShort} mintage silver coin`)}`,
  };
}

async function main() {
  const includeUnknown = process.argv.includes("--include-unknown-display");
  const limIdx = process.argv.indexOf("--limit");
  const limit = limIdx !== -1 && process.argv[limIdx + 1] ? parseInt(process.argv[limIdx + 1], 10) : null;

  const conn = await mysql.createConnection(getConfig());
  const [rows] = await conn.execute(
    `SELECT id, title, title_en, country, catalog_number, mint, source_url, mintage, mintage_display
     FROM coins
     WHERE TRIM(IFNULL(country, '')) NOT LIKE 'Россия%'
       AND (mintage IS NULL OR mintage = 0)
     ORDER BY id`
  );
  await conn.end();

  let filtered = rows;
  if (!includeUnknown) {
    filtered = rows.filter(
      (r) => !r.mintage_display || String(r.mintage_display).trim() === ""
    );
  } else {
    filtered = rows.filter((r) => coinNeedsMintageResearch(r));
  }

  const slice = limit ? filtered.slice(0, limit) : filtered;

  const byCatalogPrefix = {};
  for (const r of slice) {
    const p = catalogPrefix(r.catalog_number);
    byCatalogPrefix[p] = (byCatalogPrefix[p] || 0) + 1;
  }

  const items = slice.map((row) => ({
    coinId: row.id,
    catalog_number: row.catalog_number,
    title: row.title,
    title_en: row.title_en,
    country: row.country,
    mint: row.mint,
    source_url: row.source_url,
    searchUrls: buildSearchUrls(row),
    proposals: [],
    verifiedMintage: null,
    verifiedMintageDisplay: null,
    verificationNotes: "",
    status: "pending",
  }));

  const doc = {
    generatedAt: new Date().toISOString(),
    schemaVersion: 1,
    cohort: includeUnknown
      ? "foreign, mintage null/0, пустой display ИЛИ «Тираж не указан» (coinNeedsMintageResearch)"
      : "foreign, mintage null/0, пустой mintage_display (как backfill-foreign-mintage-empty-cohort)",
    summary: {
      total: items.length,
      byCatalogPrefix,
      note:
        "Заполните proposals из Numista/Colnect/дилеров. Если цифры на сайтах различаются — заносите все в proposals и оставляйте verified* пустыми до ручного выбора; status needs_second_source или pending.",
    },
    items,
  };

  fs.writeFileSync(OUT_JSON, JSON.stringify(doc, null, 2), "utf8");
  console.log("Записано:", OUT_JSON);
  console.log("Строк:", items.length, includeUnknown ? "(с «Тираж не указан»)" : "(только пустой display)");
  console.log("По префиксам:", byCatalogPrefix);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
