/**
 * Читает reports/missing-from-4555-coins-grouped.md (таблица Verification registry)
 * и обновляет coins.mintage / mintage_display для строк со статусом ≠ pending.
 *
 * Правила:
 *   - verified | single_source: если mintage_candidate — одно целое > 0 → mintage + подпись
 *   - no_mintage_source | partial_verified: mintage NULL, mintage_display = текст candidate (если непустой)
 *   - pending и прочее — пропуск
 *   - Россия — не трогаем
 *
 *   node scripts/apply-mintage-from-grouped-report-md.js           — сухой прогон
 *   node scripts/apply-mintage-from-grouped-report-md.js --apply   — UPDATE
 *   ... --force  — перезаписать даже если в БД тираж уже не «дырка» (осторожно)
 */
require("dotenv").config({ path: ".env" });
const fs = require("fs");
const path = require("path");
const mysql = require("mysql2/promise");
const { coinNeedsMintageResearch } = require("./parsing-mintage-constants.js");

const ROOT = path.join(__dirname, "..");
const MD_PATH = path.join(ROOT, "reports", "missing-from-4555-coins-grouped.md");
const DISPLAY_SUFFIX = " (реестр missing-from-4555)";

function getConfig() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL не задан");
  const m = url.match(/mysql:\/\/([^:]+):([^@]+)@([^:]+):(\d+)\/(.+)/);
  if (!m) throw new Error("Неверный формат DATABASE_URL");
  const [, user, password, host, port, database] = m;
  return { host, port: Number(port), user, password, database };
}

function parseTableRow(line) {
  if (!line.startsWith("|")) return null;
  const parts = line.split("|").map((s) => s.trim());
  if (!/^\d+$/.test(parts[1] || "")) return null;
  return {
    id: parseInt(parts[1], 10),
    mintage_candidate: parts[9] != null ? String(parts[9]).trim() : "",
    status: parts[11] != null ? String(parts[11]).trim() : "",
  };
}

function parseSingleMintage(candidate) {
  const m = String(candidate || "").match(/^\s*(\d{1,12})\s*$/);
  if (!m) return null;
  const n = parseInt(m[1], 10);
  return n > 0 ? n : null;
}

function resolveUpdate(row) {
  const st = row.status;
  if (!st || st === "pending") return null;
  const cand = row.mintage_candidate;

  if (st === "verified" || st === "single_source") {
    const n = parseSingleMintage(cand);
    if (n != null) {
      return {
        mintage: n,
        mintage_display: `${n.toLocaleString("ru-RU")}${DISPLAY_SUFFIX}`,
      };
    }
    return null;
  }

  if (st === "no_mintage_source" || st === "partial_verified") {
    if (!cand) return null;
    return { mintage: null, mintage_display: cand };
  }

  return null;
}

async function main() {
  const apply = process.argv.includes("--apply");
  const force = process.argv.includes("--force");
  if (!fs.existsSync(MD_PATH)) throw new Error("Нет файла: " + MD_PATH);
  const text = fs.readFileSync(MD_PATH, "utf8");
  const lines = text.split("\n");
  const parsed = [];
  for (const line of lines) {
    const r = parseTableRow(line);
    if (r) parsed.push(r);
  }

  const conn = await mysql.createConnection(getConfig());
  const report = { apply, actions: [], skipped: 0, updated: 0, errors: [] };

  for (const row of parsed) {
    const payload = resolveUpdate(row);
    if (!payload) {
      report.skipped++;
      continue;
    }

    const [rows] = await conn.execute(
      `SELECT id, country, mintage, mintage_display, title FROM coins WHERE id = ? LIMIT 1`,
      [row.id]
    );
    if (rows.length === 0) {
      report.errors.push({ id: row.id, error: "нет в БД" });
      continue;
    }
    const db = rows[0];
    if (/^Россия/i.test(String(db.country || "").trim())) {
      report.skipped++;
      report.actions.push({ id: row.id, result: "skip", reason: "Россия" });
      continue;
    }

    if (!force && !coinNeedsMintageResearch(db)) {
      report.skipped++;
      report.actions.push({
        id: row.id,
        result: "skip",
        reason: "в БД тираж уже не «дырка» (используйте --force чтобы перезаписать)",
        status: row.status,
      });
      continue;
    }

    report.actions.push({
      id: row.id,
      status: row.status,
      from: { mintage: db.mintage, mintage_display: db.mintage_display },
      to: payload,
    });

    if (apply) {
      await conn.execute(`UPDATE coins SET mintage = ?, mintage_display = ? WHERE id = ?`, [
        payload.mintage,
        payload.mintage_display,
        row.id,
      ]);
      report.updated++;
    }
  }

  await conn.end();
  const toApply = report.actions.filter((a) => a.to);
  console.log(
    JSON.stringify({ ...report, parsedRows: parsed.length, wouldUpdate: toApply.length, force }, null, 2)
  );
  if (!apply) console.log("\nСухой прогон. Запись: --apply");
  else console.log("\nОбновлено:", report.updated);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
