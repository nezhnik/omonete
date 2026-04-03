/**
 * Сводка по когорте из reports/missing-from-4555-coins.json:
 * сколько id ещё без числового тиража и с пустым / «Тираж не указан» display
 * (как coinNeedsMintageResearch для экспорта).
 *
 *   node scripts/report-missing-4555-cohort-status.js
 */
require("dotenv").config({ path: ".env" });
const fs = require("fs");
const path = require("path");
const mysql = require("mysql2/promise");
const { coinNeedsMintageResearch } = require("./parsing-mintage-constants.js");

const ROOT = path.join(__dirname, "..");
const JSON_PATH = path.join(ROOT, "reports", "missing-from-4555-coins.json");

function getConfig() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL не задан");
  const m = url.match(/mysql:\/\/([^:]+):([^@]+)@([^:]+):(\d+)\/(.+)/);
  if (!m) throw new Error("Неверный формат DATABASE_URL");
  const [, user, password, host, port, database] = m;
  return { host, port: Number(port), user, password, database };
}

async function main() {
  const doc = JSON.parse(fs.readFileSync(JSON_PATH, "utf8"));
  const ids = (doc.items || []).map((it) => parseInt(it.id, 10)).filter((n) => Number.isFinite(n));
  const conn = await mysql.createConnection(getConfig());
  const placeholders = ids.map(() => "?").join(",");
  const [rows] = await conn.execute(
    `SELECT id, mintage, mintage_display FROM coins WHERE id IN (${placeholders})`,
    ids
  );
  await conn.end();

  const byId = new Map(rows.map((r) => [Number(r.id), r]));
  let stillNeeds = 0;
  const samples = [];
  for (const id of ids) {
    const r = byId.get(id);
    if (!r) continue;
    if (coinNeedsMintageResearch(r)) {
      stillNeeds++;
      if (samples.length < 15) samples.push({ id, mintage: r.mintage, mintage_display: r.mintage_display });
    }
  }

  const out = {
    generatedAt: new Date().toISOString(),
    cohortFile: "reports/missing-from-4555-coins.json",
    cohortIds: ids.length,
    foundInDb: rows.length,
    stillMintageNeedsResearch: stillNeeds,
    /** В БД найдены и тираж не в статусе «нужно исследование» */
    closedInCohort: rows.length - stillNeeds,
    notFoundInDb: ids.length - rows.length,
    sampleStillGap: samples,
  };
  const outPath = path.join(ROOT, "reports", "missing-from-4555-cohort-status.json");
  fs.writeFileSync(outPath, JSON.stringify(out, null, 2), "utf8");
  console.log(JSON.stringify(out, null, 2));
  console.log("\nЗаписано:", outPath);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
