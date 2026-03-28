/**
 * Читает data/secondary-mintage-research-queue.json и обновляет coins.mintage / mintage_display
 * для строк со status === "ready_for_db".
 *
 * Условия записи:
 *   - verifiedMintage — целое > 0, ИЛИ
 *   - непустой verifiedMintageDisplay (текст без числа, напр. неограниченный тираж) — тогда mintage = NULL
 *
 * Безопасность: сверка catalog_number с БД; пропуск России.
 *
 *   node scripts/apply-secondary-mintage-from-queue.js           — сухой прогон + отчёт JSON
 *   node scripts/apply-secondary-mintage-from-queue.js --apply   — UPDATE
 *   node scripts/apply-secondary-mintage-from-queue.js --coin-id 6018 --apply
 */
require("dotenv").config({ path: ".env" });
const mysql = require("mysql2/promise");
const fs = require("fs");
const path = require("path");

const QUEUE_PATH = path.join(__dirname, "..", "data", "secondary-mintage-research-queue.json");
const REPORT_PATH = path.join(__dirname, "..", "data", "secondary-mintage-apply-report.json");

function getConfig() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL не задан");
  const m = url.match(/mysql:\/\/([^:]+):([^@]+)@([^:]+):(\d+)\/(.+)/);
  if (!m) throw new Error("Неверный формат DATABASE_URL");
  const [, user, password, host, port, database] = m;
  return { host, port: Number(port), user, password, database };
}

function parseMintageInt(v) {
  if (v == null) return null;
  if (typeof v === "number" && Number.isInteger(v) && v > 0) return v;
  const n = parseInt(String(v).replace(/\s/g, ""), 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function defaultDisplayFromNumber(n) {
  return `${n.toLocaleString("en-US")} (вторичные источники)`;
}

function resolvePayload(item) {
  const dispRaw = item.verifiedMintageDisplay != null ? String(item.verifiedMintageDisplay).trim() : "";
  const num = parseMintageInt(item.verifiedMintage);

  if (num != null) {
    return {
      mintage: num,
      mintage_display: dispRaw || defaultDisplayFromNumber(num),
    };
  }
  if (dispRaw) {
    return { mintage: null, mintage_display: dispRaw };
  }
  return null;
}

async function main() {
  const apply = process.argv.includes("--apply");
  const idIdx = process.argv.indexOf("--coin-id");
  const onlyId = idIdx !== -1 && process.argv[idIdx + 1] ? parseInt(process.argv[idIdx + 1], 10) : null;

  if (!fs.existsSync(QUEUE_PATH)) throw new Error("Нет файла: " + QUEUE_PATH);
  const doc = JSON.parse(fs.readFileSync(QUEUE_PATH, "utf8"));
  const items = Array.isArray(doc.items) ? doc.items : [];

  const conn = await mysql.createConnection(getConfig());
  const report = {
    generatedAt: new Date().toISOString(),
    apply,
    onlyId,
    eligible: 0,
    skipped: 0,
    updated: 0,
    errors: [],
    actions: [],
  };

  for (const item of items) {
    const coinId = item.coinId;
    if (onlyId != null && coinId !== onlyId) continue;

    if (String(item.status || "") !== "ready_for_db") continue;

    const payload = resolvePayload(item);
    if (!payload) {
      report.skipped++;
      report.actions.push({
        coinId,
        result: "skip",
        reason: "ready_for_db, но нет verifiedMintage > 0 и нет verifiedMintageDisplay",
      });
      continue;
    }

    report.eligible++;

    const [rows] = await conn.execute(
      `SELECT id, country, catalog_number, mintage, mintage_display FROM coins WHERE id = ? LIMIT 1`,
      [coinId]
    );
    if (rows.length === 0) {
      report.errors.push({ coinId, error: "coin id не найден в БД" });
      continue;
    }
    const row = rows[0];
    const country = String(row.country || "").trim();
    if (/^Россия/i.test(country)) {
      report.skipped++;
      report.actions.push({ coinId, result: "skip", reason: "Россия — не трогаем" });
      continue;
    }

    const dbCat = String(row.catalog_number || "").trim();
    const fileCat = String(item.catalog_number || "").trim();
    if (fileCat && dbCat && fileCat !== dbCat) {
      report.errors.push({
        coinId,
        error: `catalog_number не совпадает: в файле «${fileCat}», в БД «${dbCat}»`,
      });
      continue;
    }

    report.actions.push({
      coinId,
      catalog_number: dbCat,
      result: apply ? "updated" : "would_update",
      fromMintage: row.mintage,
      fromDisplay: row.mintage_display,
      toMintage: payload.mintage,
      toDisplay: payload.mintage_display,
    });

    if (apply) {
      await conn.execute(`UPDATE coins SET mintage = ?, mintage_display = ? WHERE id = ?`, [
        payload.mintage,
        payload.mintage_display,
        coinId,
      ]);
      report.updated++;
    }
  }

  await conn.end();

  fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2), "utf8");
  console.log(JSON.stringify(report, null, 2));
  console.log("\nОтчёт:", REPORT_PATH);
  if (!apply) console.log("Сухой прогон. Для записи в БД: добавьте --apply");
  else console.log("Обновлено строк:", report.updated, "| готово к обновлению было:", report.eligible);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
