/**
 * Для монет PAMP в БД подставляет mintage / mintage_display из data/pamp-collectible-*.json.
 * Если в JSON тиража нет — ставит mintage_display = "Н/Д", чтобы монета снова проходила
 * фильтр rowsToExport в export-coins-to-json.js (иностранная + есть текст тиража).
 *
 * Запуск после правок JSON или если после импорта часть позиций пропала из каталога:
 *   node scripts/pamp-repair-export-fields-from-json.js
 */
require("dotenv").config({ path: ".env" });
const fs = require("fs");
const path = require("path");
const mysql = require("mysql2/promise");

const DATA_DIR = path.join(__dirname, "..", "data");

function getConfig() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL не задан");
  const m = url.match(/mysql:\/\/([^:]+):([^@]+)@([^:]+):(\d+)\/(.+)/);
  if (!m) throw new Error("Неверный формат DATABASE_URL");
  const [, user, password, host, port, database] = m;
  return { host, port: Number(port), user, password, database };
}

function normalizeUrl(url) {
  if (!url || typeof url !== "string") return null;
  try {
    const u = new URL(url.trim());
    u.hash = "";
    u.search = "";
    return u.toString().replace(/\/+$/, "");
  } catch {
    return String(url).trim().replace(/\/+$/, "") || null;
  }
}

function parseMintage(specs, title) {
  const specM = specs.Mintage != null ? String(specs.Mintage).trim() : "";
  if (specM) {
    const digits = specM.replace(/[^\d]/g, "");
    const n = digits ? Number(digits) : null;
    return { mintage: Number.isFinite(n) && n > 0 ? n : null, mintageDisplay: specM || null };
  }
  const t = String(title || "").trim();
  const fromDesc = t.match(/\blimited mintage of\s*([\d,.\s]+)\b/i);
  if (fromDesc) {
    const display = fromDesc[1].replace(/\s+/g, " ").trim();
    const digits = display.replace(/[^\d]/g, "");
    const n = digits ? Number(digits) : null;
    return { mintage: Number.isFinite(n) && n > 0 ? n : null, mintageDisplay: display || null };
  }
  const fromCoinsTitle = t.match(/\bmintage of (?:only\s+)?([\d,.\s]+)\s*coins?\b/i);
  if (fromCoinsTitle) {
    const display = fromCoinsTitle[1].replace(/\s+/g, " ").trim();
    const digits = display.replace(/[^\d]/g, "");
    const n = digits ? Number(digits) : null;
    return { mintage: Number.isFinite(n) && n > 0 ? n : null, mintageDisplay: display || null };
  }
  return { mintage: null, mintageDisplay: null };
}

async function main() {
  const byUrl = new Map();
  for (const f of fs.readdirSync(DATA_DIR)) {
    if (!f.startsWith("pamp-collectible-") || !f.endsWith(".json") || f.includes("listing")) continue;
    let raw;
    try {
      raw = JSON.parse(fs.readFileSync(path.join(DATA_DIR, f), "utf8"));
    } catch {
      continue;
    }
    const u = normalizeUrl(raw.source_url);
    if (u && /pamp\.com/i.test(u)) byUrl.set(u, raw);
  }

  const conn = await mysql.createConnection(getConfig());
  const [rows] = await conn.execute(
    `SELECT id, source_url, mintage, mintage_display FROM coins
     WHERE source_url LIKE '%pamp.com/product/collectible%'`
  );

  let updated = 0;
  for (const r of rows) {
    const u = normalizeUrl(r.source_url);
    const raw = u ? byUrl.get(u) : null;
    const specs = raw ? raw.specs || {} : {};
    const title = raw ? String(raw.title || "") : "";
    const parsed = parseMintage(specs, title);
    let mintage = parsed.mintage != null ? parsed.mintage : r.mintage != null ? r.mintage : null;
    let mintageDisplay =
      parsed.mintageDisplay && String(parsed.mintageDisplay).trim()
        ? String(parsed.mintageDisplay).trim()
        : r.mintage_display != null && String(r.mintage_display).trim()
          ? String(r.mintage_display).trim()
          : null;

    const hasNumeric = mintage != null && Number(mintage) !== 0;
    const hasDisplay = mintageDisplay != null && mintageDisplay !== "";
    if (!hasNumeric && !hasDisplay) mintageDisplay = "Н/Д";

    const mNum = mintage === null || mintage === "" ? null : Number(mintage);
    const mFinal = Number.isFinite(mNum) && mNum > 0 ? mNum : null;

    const oldNum = r.mintage == null ? null : Number(r.mintage);
    const oldDisp = r.mintage_display == null ? "" : String(r.mintage_display).trim();
    const newDisp = mintageDisplay == null ? "" : String(mintageDisplay).trim();

    if (oldNum !== (mFinal == null ? null : mFinal) || oldDisp !== newDisp) {
      await conn.execute(`UPDATE coins SET mintage = ?, mintage_display = ? WHERE id = ?`, [
        mFinal,
        newDisp || "Н/Д",
        r.id,
      ]);
      updated++;
    }
  }

  await conn.end();
  console.log("✓ PAMP: обновлено записей (тираж для экспорта):", updated);
  console.log("Дальше: npm run data:export — полная выгрузка; затем build.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
