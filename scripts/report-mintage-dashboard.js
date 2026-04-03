/**
 * Единая сводка по тиражам:
 *   - весь экспортируемый каталог (те же правила отбора, что export-coins-to-json.js)
 *   - сколько с coinNeedsMintageResearch («дырка» для сайта)
 *   - когорта missing-from-4555-official-mintage-pass.json: сколько found / not_found / уже совпало с БД
 *
 * Пишет reports/mintage-dashboard.json и печатает краткую сводку.
 *
 *   node scripts/report-mintage-dashboard.js
 */
require("dotenv").config({ path: ".env" });
const fs = require("fs");
const path = require("path");
const mysql = require("mysql2/promise");
const { coinNeedsMintageResearch } = require("./parsing-mintage-constants.js");

const ROOT = path.join(__dirname, "..");
const PASS_PATH = path.join(ROOT, "reports", "missing-from-4555-official-mintage-pass.json");
const OUT_PATH = path.join(ROOT, "reports", "mintage-dashboard.json");

const EXCLUDED_EXPORT_COIN_IDS = new Set(["5998", "6000", "6012"]);

function getConfig() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL не задан");
  const m = url.match(/mysql:\/\/([^:]+):([^@]+)@([^:]+):(\d+)\/(.+)/);
  if (!m) throw new Error("Неверный формат DATABASE_URL");
  const [, user, password, host, port, database] = m;
  return { host, port: Number(port), user, password, database };
}

/** Дубликат логики export-coins-to-json.js (строки ~548–569): попадает ли монета в выгрузку каталога. */
function rowKeptInExportCatalog(r) {
  if (EXCLUDED_EXPORT_COIN_IDS.has(String(r.id))) return false;
  const hasNumericMintage = r.mintage != null && Number(r.mintage) !== 0;
  const country = (r.country || "").trim();
  const hasDisplay = r.mintage_display != null && String(r.mintage_display).trim() !== "";
  const isForeignUnlimited = country && !/^Россия/i.test(country) && hasDisplay;
  const isRoyalMintCatalog = /^GB-ROYAL-/i.test(String(r.catalog_number || "").trim());
  const isPampCollectible = /^CH-PAMP-/i.test(String(r.catalog_number || "").trim());
  const isMennicaGoldBar = /^PL-MENNICA-GOLD-BAR-/i.test(String(r.catalog_number || "").trim());
  return (
    hasNumericMintage || isForeignUnlimited || isRoyalMintCatalog || isPampCollectible || isMennicaGoldBar
  );
}

async function main() {
  const conn = await mysql.createConnection(getConfig());
  const [rows] = await conn.execute(
    `SELECT id, country, mintage, mintage_display, catalog_number FROM coins ORDER BY id`
  );
  await conn.end();

  const exported = rows.filter(rowKeptInExportCatalog);
  const needsResearch = exported.filter((r) => coinNeedsMintageResearch(r));

  let passCross = null;
  let passIdSet = null;
  if (fs.existsSync(PASS_PATH)) {
    const doc = JSON.parse(fs.readFileSync(PASS_PATH, "utf8"));
    const items = doc.items || [];
    passIdSet = new Set(items.map((it) => parseInt(it.id, 10)).filter((x) => Number.isFinite(x)));
    const byId = new Map(rows.map((r) => [Number(r.id), r]));
    const byStatus = {};
    let passFoundInDbStillGap = 0;
    let passFoundInDbClosed = 0;
    let passFoundMatchesDb = 0;
    let passFoundNotInDb = 0;
    const SKIP_IDS = new Set([4284]);
    const MAX_M = 50_000_000;

    for (const it of items) {
      const st = String(it.official_status || "unknown");
      byStatus[st] = (byStatus[st] || 0) + 1;
    }

    for (const it of items) {
      if (String(it.official_status || "") !== "found") continue;
      const id = parseInt(it.id, 10);
      const off = Number(it.official_mintage);
      if (!Number.isFinite(off) || off < 1 || off > MAX_M || SKIP_IDS.has(id)) continue;

      const db = byId.get(id);
      if (!db) {
        passFoundNotInDb++;
        continue;
      }
      if (coinNeedsMintageResearch(db)) passFoundInDbStillGap++;
      else passFoundInDbClosed++;
      const dbN = db.mintage != null && Number(db.mintage) !== 0 ? Number(db.mintage) : null;
      if (dbN === off) passFoundMatchesDb++;
    }

    passCross = {
      passFileItems: items.length,
      official_status_counts: byStatus,
      /** found + валидное число: в БД ещё «дырка» — ждут заливки */
      found_valid_still_needs_research_in_db: passFoundInDbStillGap,
      /** found + валидное число: в БД тираж уже закрыт */
      found_valid_closed_in_db: passFoundInDbClosed,
      found_valid_official_mintage_equals_db: passFoundMatchesDb,
      found_valid_coin_missing_in_db: passFoundNotInDb,
      sourceSummary: doc.summary || null,
    };
  }

  const needsResearchInPass = passIdSet
    ? needsResearch.filter((r) => passIdSet.has(Number(r.id))).length
    : null;
  const needsResearchOutsidePass = passIdSet
    ? needsResearch.filter((r) => !passIdSet.has(Number(r.id))).length
    : needsResearch.length;

  const out = {
    generatedAt: new Date().toISOString(),
    database: {
      total_rows: rows.length,
    },
    exportCatalog: {
      /** Как в public/data/coins.json после export */
      exported_count: exported.length,
      /** «Без числового тиража / Тираж не указан» — то же, что строка [тираж] в export */
      mintage_needs_research_count: needsResearch.length,
      /** Из них: id есть в official-mintage-pass (когорта 394) */
      mintage_needs_research_inside_official_pass_cohort: needsResearchInPass,
      /** Из них: вне этого pass-файла — основная оставшаяся работа */
      mintage_needs_research_outside_official_pass_cohort: needsResearchOutsidePass,
    },
    officialMintagePassFile: passCross,
    hint: "Заливка из pass: npm run coins:apply-official-mintage-pass:apply. Сводка: этот файл. Экспорт: npm run data:export.",
  };

  fs.writeFileSync(OUT_PATH, JSON.stringify(out, null, 2), "utf8");
  console.log(JSON.stringify(out, null, 2));
  console.log("\nЗаписано:", OUT_PATH);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
