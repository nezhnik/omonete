/**
 * 1) Выгружает JSON с PAMP-монетами, у которых по правилам сайта ещё нет тиража
 *    (как coinNeedsMintageResearch в export).
 * 2) Сохраняет срез «что сняли с pamp.com» из reports/mintage-export-gap-fetch-mint-filter.json.
 * 3) --apply  : для строк отчёта с числовым тиражом ещё раз записать в БД
 *               (только если строка всё ещё в статусе «нужен тираж» — идемпотентно).
 *
 *   node scripts/pamp-mintage-reports-and-apply-gap.js
 *   node scripts/pamp-mintage-reports-and-apply-gap.js --apply
 * После --apply: npm run data:export:incremental
 */
require("dotenv").config({ path: ".env" });
const fs = require("fs");
const path = require("path");
const mysql = require("mysql2/promise");
const { coinNeedsMintageResearch } = require("./parsing-mintage-constants.js");

const ROOT = path.join(__dirname, "..");
const GAP_REPORT = path.join(ROOT, "reports", "mintage-export-gap-fetch-mint-filter.json");
const OUT_MISSING = path.join(ROOT, "reports", "pamp-missing-mintage.json");
const OUT_MISSING_MD = path.join(ROOT, "reports", "pamp-missing-mintage.md");
const OUT_FOUND_SNAPSHOT = path.join(ROOT, "reports", "pamp-mintage-filled-from-gap-report.json");

function escapeMdCell(s) {
  if (s == null) return "";
  return String(s).replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
}

/** Сохраняем блок mintage_source из прошлой версии отчёта (веб-исследование), пока монета в списке без тиража */
function loadPrevMintageSourceById() {
  const map = new Map();
  try {
    if (!fs.existsSync(OUT_MISSING)) return map;
    const prev = JSON.parse(fs.readFileSync(OUT_MISSING, "utf8"));
    for (const r of prev.rows || []) {
      if (r && r.id != null && r.mintage_source && typeof r.mintage_source === "object") {
        map.set(Number(r.id), r.mintage_source);
      }
    }
  } catch (_) {
    /* ignore */
  }
  return map;
}

function webSummaryCell(row) {
  const ms = row.mintage_source;
  if (!ms) return "";
  if (ms.status === "verified" && ms.verified_mintage != null) return String(ms.verified_mintage);
  if (ms.status === "conflict") return "конфликт";
  if (ms.status === "partial" && ms.sources && ms.sources[0]) return `~${ms.sources[0].mintage}`;
  return ms.status === "none" ? "—" : "";
}

function getConfig() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL не задан");
  const m = url.match(/mysql:\/\/([^:]+):([^@]+)@([^:]+):(\d+)\/(.+)/);
  if (!m) throw new Error("Неверный формат DATABASE_URL");
  const [, user, password, host, port, database] = m;
  return { host, port: Number(port), user, password, database };
}

function isPampRowSqlFragment() {
  return `(
    catalog_number LIKE 'CH-PAMP-%'
    OR LOWER(COALESCE(mint, '')) LIKE '%pamp%'
    OR LOWER(COALESCE(mint_short, '')) LIKE '%pamp%'
  )`;
}

async function fetchPampGapSnapshot() {
  if (!fs.existsSync(GAP_REPORT)) return { items: [], note: "файл отсутствует: " + GAP_REPORT };
  const j = JSON.parse(fs.readFileSync(GAP_REPORT, "utf8"));
  const items = Array.isArray(j.items) ? j.items : [];
  const found = items.filter(
    (i) =>
      i &&
      i.method === "pamp" &&
      i.id != null &&
      !i.note &&
      i.mintage != null &&
      Number.isFinite(Number(i.mintage)) &&
      Number(i.mintage) > 0
  );
  return {
    generatedAtFromReport: j.generatedAt || null,
    totalItemsInReport: items.length,
    pampFoundCount: found.length,
    items: found.map((i) => ({
      id: Number(i.id),
      source_url: i.source_url || null,
      mintage: Number(i.mintage),
      mintage_display: (i.mintage_display_out || String(i.mintage)).trim(),
    })),
  };
}

async function applyGapToDb(conn, snapshotItems) {
  let applied = 0;
  let skipped = 0;
  for (const item of snapshotItems) {
    const id = item.id;
    const [[row]] = await conn.execute(
      "SELECT id, mintage, mintage_display FROM coins WHERE id = ? LIMIT 1",
      [id]
    );
    if (!row) {
      skipped++;
      continue;
    }
    if (!coinNeedsMintageResearch(row)) {
      skipped++;
      continue;
    }
    await conn.execute("UPDATE coins SET mintage = ?, mintage_display = ? WHERE id = ?", [
      item.mintage,
      item.mintage_display,
      id,
    ]);
    applied++;
  }
  return { applied, skipped };
}

async function fetchMissingPampFromDb(conn) {
  const sql = `
    SELECT id, catalog_number, catalog_suffix, title, title_en, country,
           mint, mint_short, mintage, mintage_display, source_url
    FROM coins
    WHERE ${isPampRowSqlFragment()}
    ORDER BY id
  `;
  const [rows] = await conn.execute(sql);
  const need = rows.filter((r) => coinNeedsMintageResearch(r));
  return need;
}

async function main() {
  const apply = process.argv.includes("--apply");
  const snapshot = await fetchPampGapSnapshot();
  fs.writeFileSync(OUT_FOUND_SNAPSHOT, JSON.stringify({ generatedAt: new Date().toISOString(), ...snapshot }, null, 2), "utf8");

  const conn = await mysql.createConnection(getConfig());
  let applyResult = null;
  try {
    if (apply && snapshot.items && snapshot.items.length) {
      applyResult = await applyGapToDb(conn, snapshot.items);
    }
    const missing = await fetchMissingPampFromDb(conn);
    const prevMintageSource = loadPrevMintageSourceById();
    const out = {
      generatedAt: new Date().toISOString(),
      criteria:
        "PAMP по полям mint/mint_short/catalog CH-PAMP-*, статус как coinNeedsMintageResearch() в parsing-mintage-constants.js",
      totalPampInDbQuery: (await conn.execute(`SELECT COUNT(*) AS c FROM coins WHERE ${isPampRowSqlFragment()}`))[0][0].c,
      missingCount: missing.length,
      applyFromGap: applyResult,
      rows: missing.map((r) => {
        const row = {
          id: r.id,
          catalog_number: r.catalog_number,
          title: r.title,
          title_en: r.title_en,
          country: r.country,
          mint: r.mint,
          mint_short: r.mint_short,
          mintage: r.mintage,
          mintage_display: r.mintage_display,
          source_url: r.source_url,
        };
        const ms = prevMintageSource.get(Number(r.id));
        if (ms) row.mintage_source = ms;
        return row;
      }),
    };
    fs.writeFileSync(OUT_MISSING, JSON.stringify(out, null, 2), "utf8");
    const mdLines = [
      `# PAMP: монеты без тиража (нужен research)`,
      ``,
      `- **Сгенерировано:** ${out.generatedAt}`,
      `- **Всего PAMP в БД (выборка):** ${out.totalPampInDbQuery}`,
      `- **Без тиража:** ${out.missingCount}`,
      ``,
      `Колонка **web**: черновик с внешних сайтов (\`mintage_source\` в JSON). Перед БД — ручная проверка.`,
      ``,
      `Критерий: ${out.criteria}`,
      ``,
      `| id | web | catalog_number | title | source_url |`,
      `| ---: | --- | --- | --- | --- |`,
    ];
    for (const row of out.rows) {
      mdLines.push(
        `| ${row.id} | ${escapeMdCell(webSummaryCell(row))} | ${escapeMdCell(row.catalog_number)} | ${escapeMdCell(row.title)} | ${escapeMdCell(row.source_url)} |`
      );
    }
    fs.writeFileSync(OUT_MISSING_MD, mdLines.join("\n"), "utf8");
    console.log(JSON.stringify({ ...out, rows: `[${out.rows.length} строк, см. ${OUT_MISSING}]` }, null, 2));
    console.log("\nФайлы:");
    console.log(" — только без тиража (JSON):", OUT_MISSING);
    console.log(" — только без тиража (Markdown):", OUT_MISSING_MD);
    console.log(" — снятые с сайта (срез отчёта gap):", OUT_FOUND_SNAPSHOT);
    if (apply && applyResult) console.log(" — apply:", applyResult);
    else if (apply) console.log(" — apply: нет строк в срезе или нет snapshot.items");
    if (!apply) console.log("\nЗапись в БД из отчёта: добавьте флаг --apply");
  } finally {
    await conn.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
