/**
 * Подтягивает в data/*.json из MySQL (по source_url) поля картинок для импортов:
 * imageUrls, image_obverse, image_reverse, image_packaging, image_box — чтобы *:import
 * не затирал миграцию unified webp (в т.ч. Royal Dutch pack/box в JSON).
 *
 *   node scripts/sync-source-json-images-from-db.js
 *   node scripts/sync-source-json-images-from-db.js --dry-run
 */
require("dotenv").config({ path: ".env" });
const mysql = require("mysql2/promise");
const fs = require("fs");
const path = require("path");

const DATA_DIR = path.join(__dirname, "..", "data");
const REPORT_PATH = path.join(__dirname, "..", "reports", "sync-source-json-images-from-db.json");

function getConfig() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL не задан");
  const m = url.match(/mysql:\/\/([^:]+):([^@]+)@([^:]+):(\d+)\/(.+)/);
  if (!m) throw new Error("Неверный формат DATABASE_URL");
  const [, user, password, host, port, database] = m;
  return { host, port: Number(port), user, password, database };
}

/** Как в import-scottsdale-to-db.js */
function normalizeUrl(raw) {
  if (!raw || typeof raw !== "string") return null;
  try {
    const u = new URL(raw.trim());
    u.hash = "";
    u.search = "";
    return `${u.origin}${u.pathname}`.replace(/\/+$/, "");
  } catch {
    return null;
  }
}

function parseImageUrls(cell) {
  if (cell == null || cell === "") return [];
  if (Array.isArray(cell)) return cell.filter(Boolean);
  try {
    const a = JSON.parse(String(cell));
    return Array.isArray(a) ? a.filter(Boolean) : [];
  } catch {
    return [];
  }
}

function getImageContainer(raw) {
  if (raw && typeof raw.coin === "object" && raw.coin) {
    return { root: raw, target: raw.coin };
  }
  return { root: raw, target: raw };
}

function shouldSkipFile(name) {
  if (!name.endsWith(".json")) return true;
  if (name.includes("listing-products")) return true;
  if (name.includes("listing-urls")) return true;
  return false;
}

function sameUrls(a, b) {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const cfg = getConfig();
  const conn = await mysql.createConnection(cfg);
  const [rows] = await conn.execute(
    `SELECT source_url, image_urls, image_obverse, image_reverse, image_packaging, image_box FROM coins
     WHERE source_url IS NOT NULL AND TRIM(source_url) != ''`
  );
  await conn.end();

  const byUrl = new Map();
  for (const r of rows) {
    const k = normalizeUrl(r.source_url);
    if (!k) continue;
    let urls = parseImageUrls(r.image_urls).slice(0, 7);
    const ob = r.image_obverse || null;
    const rev = r.image_reverse || null;
    if (!urls.length && (ob || rev)) {
      urls = [ob, rev].filter(Boolean).slice(0, 7);
    }
    byUrl.set(k, {
      imageUrls: urls,
      image_obverse: ob,
      image_reverse: rev,
      image_packaging: r.image_packaging ?? null,
      image_box: r.image_box ?? null,
    });
  }

  const files = fs.readdirSync(DATA_DIR).filter((f) => !shouldSkipFile(f));
  const report = {
    dryRun,
    dbRowsWithSourceUrl: byUrl.size,
    filesSeen: 0,
    filesUpdated: 0,
    skippedNoSourceUrl: 0,
    skippedNotInDb: 0,
    skippedNoImagesInDb: 0,
    errors: [],
  };

  for (const f of files) {
    const fp = path.join(DATA_DIR, f);
    report.filesSeen++;
    let raw;
    try {
      raw = JSON.parse(fs.readFileSync(fp, "utf8"));
    } catch (e) {
      report.errors.push({ file: f, error: e.message || String(e) });
      continue;
    }

    const { root, target } = getImageContainer(raw);
    const su = normalizeUrl(target.source_url || target.sourceUrl || root.source_url);
    if (!su) {
      report.skippedNoSourceUrl++;
      continue;
    }
    const dbRow = byUrl.get(su);
    if (!dbRow) {
      report.skippedNotInDb++;
      continue;
    }
    const hasFrames =
      dbRow.imageUrls.length > 0 || dbRow.image_obverse || dbRow.image_reverse;
    const pkgDb = dbRow.image_packaging ?? null;
    const boxDb = dbRow.image_box ?? null;
    const hasPkgBox = !!(pkgDb || boxDb);
    if (!hasFrames && !hasPkgBox) {
      report.skippedNoImagesInDb++;
      continue;
    }

    let changed = false;
    const urls = dbRow.imageUrls;

    if (hasFrames) {
      if (urls.length > 0 && !sameUrls(target.imageUrls, urls)) {
        target.imageUrls = urls;
        changed = true;
      }
      const obv = dbRow.image_obverse || urls[0] || null;
      const rev = dbRow.image_reverse || urls[1] || urls[0] || null;
      if (target.image_obverse !== obv) {
        target.image_obverse = obv;
        changed = true;
      }
      if (target.image_reverse !== rev) {
        target.image_reverse = rev;
        changed = true;
      }
    }

    if (
      Object.prototype.hasOwnProperty.call(target, "image_packaging") ||
      Object.prototype.hasOwnProperty.call(target, "image_box") ||
      pkgDb ||
      boxDb
    ) {
      if (target.image_packaging !== pkgDb) {
        target.image_packaging = pkgDb;
        changed = true;
      }
      if (target.image_box !== boxDb) {
        target.image_box = boxDb;
        changed = true;
      }
    }

    if (changed) {
      report.filesUpdated++;
      if (!dryRun) {
        fs.writeFileSync(fp, JSON.stringify(root, null, 2) + "\n", "utf8");
      }
    }
  }

  fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true });
  fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2), "utf8");

  console.log(dryRun ? "(dry-run) изменения не записаны" : "Записано на диск");
  console.log(report);
  console.log("Отчёт:", REPORT_PATH);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
