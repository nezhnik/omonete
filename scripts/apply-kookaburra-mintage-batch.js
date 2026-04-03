/**
 * Читает data/kookaburra-mintage-final-batch.json и обновляет mintage / mintage_display / source_url.
 *
 *   node scripts/apply-kookaburra-mintage-batch.js           — сухой прогон
 *   node scripts/apply-kookaburra-mintage-batch.js --apply  — запись в БД
 */
require("dotenv").config({ path: ".env" });
const mysql = require("mysql2/promise");
const fs = require("fs");
const path = require("path");

const BATCH_PATH = path.join(__dirname, "..", "data", "kookaburra-mintage-final-batch.json");
const REPORT_PATH = path.join(__dirname, "..", "reports", "kookaburra-mintage-apply-report.json");

function getConfig() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL не задан");
  const m = url.match(/mysql:\/\/([^:]+):([^@]+)@([^:]+):(\d+)\/(.+)/);
  if (!m) throw new Error("Неверный формат DATABASE_URL");
  const [, user, password, host, port, database] = m;
  return { host, port: Number(port), user, password, database };
}

async function main() {
  const apply = process.argv.includes("--apply");
  if (!fs.existsSync(BATCH_PATH)) throw new Error("Нет файла: " + BATCH_PATH);
  const doc = JSON.parse(fs.readFileSync(BATCH_PATH, "utf8"));
  const items = Array.isArray(doc.items) ? doc.items : [];

  const conn = await mysql.createConnection(getConfig());
  const report = { generatedAt: new Date().toISOString(), apply, updated: 0, errors: [], actions: [] };

  for (const item of items) {
    const coinId = item.coinId;
    const mintage = item.mintage != null ? Number(item.mintage) : null;
    const disp = item.mintage_display != null ? String(item.mintage_display).trim() : "";
    const src = item.source_url != null ? String(item.source_url).trim() : null;

    if (!coinId || !Number.isFinite(mintage) || mintage <= 0 || !disp) {
      report.errors.push({ coinId, error: "некорректные coinId / mintage / mintage_display" });
      continue;
    }

    const [rows] = await conn.execute(
      `SELECT id, country, title, mintage, mintage_display, source_url FROM coins WHERE id = ? LIMIT 1`,
      [coinId]
    );
    if (rows.length === 0) {
      report.errors.push({ coinId, error: "coin id не найден в БД" });
      continue;
    }
    const row = rows[0];
    if (/^Россия/i.test(String(row.country || "").trim())) {
      report.actions.push({ coinId, result: "skip", reason: "Россия" });
      continue;
    }

    report.actions.push({
      coinId,
      title: row.title,
      result: apply ? "updated" : "would_update",
      fromMintage: row.mintage,
      toMintage: mintage,
    });

    if (apply) {
      if (src)
        await conn.execute(`UPDATE coins SET mintage = ?, mintage_display = ?, source_url = ? WHERE id = ?`, [
          mintage,
          disp,
          src,
          coinId,
        ]);
      else
        await conn.execute(`UPDATE coins SET mintage = ?, mintage_display = ? WHERE id = ?`, [mintage, disp, coinId]);
      report.updated++;
    }
  }

  await conn.end();
  fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true });
  fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2), "utf8");
  console.log(JSON.stringify(report, null, 2));
  console.log("\nОтчёт:", REPORT_PATH);
  if (!apply) console.log("Сухой прогон. Для записи: --apply");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
