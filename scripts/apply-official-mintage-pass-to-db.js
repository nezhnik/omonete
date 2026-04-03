/**
 * Заливает в MySQL тиражи из reports/missing-from-4555-official-mintage-pass.json
 * (результат автопрохода по официальным source_url).
 *
 * Условия UPDATE:
 *   - official_status === "found"
 *   - official_mintage — целое в разумных пределах (см. isSaneMintage)
 *   - страна ≠ Россия
 *   - по умолчанию только если в БД ещё coinNeedsMintageResearch (как в экспорте)
 *   - --force: перезаписать mintage/mintage_display даже если тираж уже закрыт (осторожно)
 *
 * Пропускаются id с известными ошибками парсера (напр. склейка цифр наборов).
 *
 *   node scripts/apply-official-mintage-pass-to-db.js
 *   node scripts/apply-official-mintage-pass-to-db.js --apply
 */
require("dotenv").config({ path: ".env" });
const fs = require("fs");
const path = require("path");
const mysql = require("mysql2/promise");
const { coinNeedsMintageResearch } = require("./parsing-mintage-constants.js");

const ROOT = path.join(__dirname, "..");
const PASS_PATH = path.join(ROOT, "reports", "missing-from-4555-official-mintage-pass.json");
const REPORT_PATH = path.join(ROOT, "reports", "mintage-apply-official-pass-report.json");

const DISPLAY_NOTE = " (официальный сайт, pass 2026-03-31)";

/** Известные битые строки автопарсера (не заливать). */
const SKIP_COIN_IDS = new Set([4284]);

const MAX_MINTAGE = 50_000_000;

function getConfig() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL не задан");
  const m = url.match(/mysql:\/\/([^:]+):([^@]+)@([^:]+):(\d+)\/(.+)/);
  if (!m) throw new Error("Неверный формат DATABASE_URL");
  const [, user, password, host, port, database] = m;
  return { host, port: Number(port), user, password, database };
}

function isSaneMintage(n, coinId) {
  if (SKIP_COIN_IDS.has(coinId)) return false;
  if (n == null || typeof n !== "number" || !Number.isFinite(n)) return false;
  const x = Math.floor(n);
  if (x < 1 || x > MAX_MINTAGE) return false;
  if (x > 10_000_000 && String(x).length > 8) return false;
  return true;
}

function displayFromOfficial(item) {
  const raw = item.official_mintage_display != null ? String(item.official_mintage_display).trim() : "";
  if (raw) return `${raw}${DISPLAY_NOTE}`;
  const n = item.official_mintage;
  return `${Number(n).toLocaleString("ru-RU")}${DISPLAY_NOTE}`;
}

async function main() {
  const apply = process.argv.includes("--apply");
  const force = process.argv.includes("--force");

  const doc = JSON.parse(fs.readFileSync(PASS_PATH, "utf8"));
  const items = Array.isArray(doc.items) ? doc.items : [];

  const conn = await mysql.createConnection(getConfig());
  const passIds = items.map((item) => parseInt(item.id, 10)).filter((x) => Number.isFinite(x));
  const uniqueIds = [...new Set(passIds)];
  let dbById = new Map();
  if (uniqueIds.length > 0) {
    const placeholders = uniqueIds.map(() => "?").join(",");
    const [dbRows] = await conn.execute(
      `SELECT id, country, mintage, mintage_display, title FROM coins WHERE id IN (${placeholders})`,
      uniqueIds
    );
    dbById = new Map(dbRows.map((r) => [Number(r.id), r]));
  }

  const report = {
    generatedAt: new Date().toISOString(),
    apply,
    force,
    sourceSummary: doc.summary || null,
    updated: 0,
    skipped: 0,
    skippedBadNumber: 0,
    skippedNotFound: 0,
    skippedRussia: 0,
    skippedNoChange: 0,
    skippedAlreadyOk: 0,
    errors: [],
    actions: [],
  };

  for (const item of items) {
    const id = parseInt(item.id, 10);
    if (!Number.isFinite(id)) continue;

    if (item.official_status !== "found") {
      report.skippedNotFound++;
      continue;
    }

    const n = item.official_mintage;
    if (!isSaneMintage(n, id)) {
      report.skippedBadNumber++;
      report.actions.push({ id, result: "skip_bad_number", official_mintage: n });
      continue;
    }

    const row = dbById.get(id);
    if (!row) {
      report.errors.push({ id, error: "нет в БД" });
      continue;
    }
    if (/^Россия/i.test(String(row.country || "").trim())) {
      report.skippedRussia++;
      continue;
    }

    if (!force && !coinNeedsMintageResearch(row)) {
      const dbN = row.mintage != null && Number(row.mintage) !== 0 ? Number(row.mintage) : null;
      if (dbN === n) report.skippedAlreadyOk++;
      else report.skippedNoChange++;
      report.actions.push({
        id,
        result: "skip_db_already_closed",
        dbMintage: row.mintage,
        official: n,
      });
      continue;
    }

    const mintage_display = displayFromOfficial(item);

    report.actions.push({
      id,
      result: apply ? "updated" : "would_update",
      from: { mintage: row.mintage, mintage_display: row.mintage_display },
      to: { mintage: n, mintage_display },
    });

    if (apply) {
      await conn.execute(`UPDATE coins SET mintage = ?, mintage_display = ? WHERE id = ?`, [n, mintage_display, id]);
      report.updated++;
    }
  }

  await conn.end();

  const forFile = { ...report };
  forFile.actions = report.actions.filter((a) => a.result === "updated" || a.result === "would_update" || a.result === "skip_bad_number");
  if (forFile.actions.length > 500) forFile.actions = forFile.actions.slice(0, 500);

  fs.writeFileSync(REPORT_PATH, JSON.stringify(forFile, null, 2), "utf8");
  const logOut = { ...report, actions: `[${report.actions.length} записей, в файле только would_update / updated / skip_bad_number]` };
  console.log(JSON.stringify(logOut, null, 2));
  console.log("\nОтчёт:", REPORT_PATH);
  if (!apply) console.log("Сухой прогон. Запись в БД: --apply");
  else console.log("Готово. Далее: npm run data:export && npm run coins:report-mintage-dashboard");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
