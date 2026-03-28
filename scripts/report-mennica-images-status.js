/**
 * Отчёт: Mennica — что в JSON (парсер), что в БД, есть ли файлы на диске.
 *
 *   node scripts/report-mennica-images-status.js
 *   node scripts/report-mennica-images-status.js --json data/mennica-image-report.json
 *
 * Причины без картинки на сайте:
 *   no_url_in_json     — в data/mennica-*.json нет http(s) в classified.obverse/reverse
 *   json_ok_db_empty   — в JSON URL есть, в БД image_* NULL (не скачали при импорте или не импортировали)
 *   db_path_no_file    — в БД путь есть, файла нет под public/
 *   partial_json       — в JSON только одна сторона
 *   not_in_db          — строки в coins с таким catalog нет
 */
require("dotenv").config({ path: ".env" });
const fs = require("fs");
const path = require("path");
const mysql = require("mysql2/promise");

const DATA_DIR = path.join(__dirname, "..", "data");
const PUBLIC_DIR = path.join(__dirname, "..", "public");

function slugFromFilename(file) {
  const base = path.basename(file, ".json");
  if (!base.startsWith("mennica-")) return null;
  return base.slice("mennica-".length);
}

function catalogFromSlug(slug) {
  return `PL-MENNICA-${String(slug || "").toUpperCase()}`.slice(0, 64);
}

function normalizeSourceUrl(u) {
  if (!u || typeof u !== "string") return "";
  try {
    const x = new URL(u.trim());
    x.hash = "";
    x.search = "";
    return x.toString().replace(/\/+$/, "").toLowerCase();
  } catch {
    return String(u).trim().replace(/\/+$/, "").toLowerCase();
  }
}

function isHttp(u) {
  return typeof u === "string" && /^https?:\/\//i.test(u.trim());
}

function fileExistsPublic(rel) {
  if (!rel || typeof rel !== "string") return false;
  const p = rel.trim();
  if (!p.startsWith("/")) return false;
  const abs = path.join(PUBLIC_DIR, p.replace(/^\//, ""));
  return fs.existsSync(abs) && fs.statSync(abs).size > 0;
}

function getConfig() {
  const url = process.env.DATABASE_URL;
  if (!url) return null;
  const m = url.match(/mysql:\/\/([^:]+):([^@]+)@([^:]+):(\d+)\/(.+)/);
  if (!m) return null;
  const [, user, password, host, port, database] = m;
  return { host, port: Number(port), user, password, database };
}

function classify({ jObv, jRev, dbObv, dbRev }) {
  const jO = isHttp(jObv);
  const jR = isHttp(jRev);
  const dO = dbObv && String(dbObv).trim();
  const dR = dbRev && String(dbRev).trim();
  const fO = dO ? fileExistsPublic(dO) : false;
  const fR = dR ? fileExistsPublic(dR) : false;

  if (!jO && !jR) return "no_url_in_json";
  if ((jO || jR) && !dO && !dR) return "json_ok_db_empty";
  if ((dO && !fO) || (dR && !fR)) return "db_path_no_file";

  const oneJsonSide = (jO && !jR) || (!jO && jR);
  const bothDbFiles = fO && fR;
  const anyDbFile = fO || fR;

  if (jO && jR && bothDbFiles) {
    if (String(jObv).trim() === String(jRev).trim()) return "ok_duplicate_sides_in_json";
    return "ok";
  }
  if (jO && jR && anyDbFile && !bothDbFiles) return "partial_db";
  if (oneJsonSide && anyDbFile) return "partial_json_db_has_file";
  if (oneJsonSide) return "partial_json_no_db";
  if (anyDbFile) return "partial_db";
  return "unknown";
}

async function main() {
  const jsonOutArg = process.argv.indexOf("--json");
  const jsonOutPath =
    jsonOutArg >= 0 && process.argv[jsonOutArg + 1]
      ? path.isAbsolute(process.argv[jsonOutArg + 1])
        ? process.argv[jsonOutArg + 1]
        : path.join(process.cwd(), process.argv[jsonOutArg + 1])
      : null;

  const files = fs
    .readdirSync(DATA_DIR)
    .filter(
      (f) =>
        f.startsWith("mennica-") &&
        f.endsWith(".json") &&
        !f.includes("listing-products") &&
        !f.includes("image-report")
    )
    .map((f) => path.join(DATA_DIR, f))
    .sort();

  const cfg = getConfig();
  let conn = null;
  /** Надёжнее catalog_number (обрезка до 64 символов даёт коллизии) */
  const dbBySourceUrl = new Map();
  if (cfg) {
    conn = await mysql.createConnection(cfg);
    const [rows] = await conn.execute(
      `SELECT id, catalog_number, source_url, image_obverse, image_reverse
       FROM coins
       WHERE source_url LIKE '%inwestycje.mennica.com.pl%'`
    );
    for (const r of rows) {
      const k = normalizeSourceUrl(r.source_url);
      if (k) dbBySourceUrl.set(k, r);
    }
    await conn.end();
  }

  const rows = [];
  const counts = {};

  for (const fp of files) {
    const slug = slugFromFilename(fp);
    if (!slug) continue;
    let raw;
    try {
      raw = JSON.parse(fs.readFileSync(fp, "utf8"));
    } catch {
      continue;
    }
    if (!raw.source_url || !String(raw.source_url).includes("mennica.com.pl")) continue;
    const jObv = raw.classified?.obverse;
    const jRev = raw.classified?.reverse;
    const srcKey = normalizeSourceUrl(raw.source_url);
    const dbRow = srcKey ? dbBySourceUrl.get(srcKey) : null;
    if (!dbRow) {
      const reason = "not_in_db";
      counts[reason] = (counts[reason] || 0) + 1;
      rows.push({
        slug,
        title: (raw.title || "").slice(0, 80),
        reason,
        json_obverse: isHttp(jObv) ? "yes" : "no",
        json_reverse: isHttp(jRev) ? "yes" : "no",
        db_obverse: null,
        db_reverse: null,
        source_url: raw.source_url || null,
        normalized_source_key: srcKey || null,
        catalog_guess: catalogFromSlug(slug),
      });
      continue;
    }

    const dbObv = dbRow.image_obverse;
    const dbRev = dbRow.image_reverse;
    const reason = classify({ jObv, jRev, dbObv, dbRev });

    counts[reason] = (counts[reason] || 0) + 1;
    rows.push({
      slug,
      coin_id: dbRow.id,
      title: (raw.title || "").slice(0, 80),
      reason,
      json_obverse: isHttp(jObv) ? String(jObv).slice(0, 120) : null,
      json_reverse: isHttp(jRev) ? String(jRev).slice(0, 120) : null,
      db_obverse: dbObv || null,
      db_reverse: dbRev || null,
      file_obverse_exists: dbObv ? fileExistsPublic(dbObv) : false,
      file_reverse_exists: dbRev ? fileExistsPublic(dbRev) : false,
      source_url: raw.source_url || dbRow.source_url,
    });
  }

  console.log("=== Mennica: картинки (JSON → БД → файл) ===\n");
  console.log("Файлов JSON:", files.length);
  console.log("Строк в БД с mennica.com.pl в source_url:", dbBySourceUrl.size);
  if (!cfg) console.log("\n(!) DATABASE_URL нет — только разбор JSON, колонки БД пустые в отчёте.\n");

  console.log("\n--- Сводка по причинам ---");
  const order = [
    "ok",
    "ok_duplicate_sides_in_json",
    "partial_json_db_has_file",
    "partial_json_no_db",
    "partial_db",
    "no_url_in_json",
    "json_ok_db_empty",
    "db_path_no_file",
    "not_in_db",
    "unknown",
  ];
  for (const k of order) {
    if (counts[k]) console.log(`  ${k}: ${counts[k]}`);
  }
  for (const k of Object.keys(counts).sort()) {
    if (!order.includes(k)) console.log(`  ${k}: ${counts[k]}`);
  }

  const problems = rows.filter(
    (r) =>
      r.reason !== "ok" &&
      r.reason !== "ok_duplicate_sides_in_json" &&
      r.reason !== "partial_json_db_has_file"
  );
  if (problems.length) {
    console.log("\n--- Проблемные монеты (первые 40) ---");
    for (const r of problems.slice(0, 40)) {
      console.log(`\n[${r.reason}] ${r.slug}  id=${r.coin_id ?? "—"}`);
      console.log("  title:", r.title);
      if (r.reason === "no_url_in_json") console.log("  парсер не записал http(s) в classified.obverse/reverse");
      if (r.reason === "json_ok_db_empty")
        console.log("  в JSON были URL, в БД NULL — импорт не скачал (сеть/sharp) или монета не обновлялась");
      if (r.reason === "db_path_no_file")
        console.log("  в БД путь есть, файла нет в public/", r.db_obverse, r.db_reverse);
      if (r.reason === "not_in_db")
        console.log("  нет строки в coins по source_url из JSON (импорт не делали или другой URL)");
      if (r.reason === "partial_json_no_db")
        console.log("  в JSON одна сторона и в БД нет путей — импорт не записал картинку");
      if (r.reason === "partial_db")
        console.log("  в JSON две стороны, в БД/на диске только одна картинка");
    }
    if (problems.length > 40) console.log("\n... ещё", problems.length - 40, "— см. JSON-отчёт");
  }

  if (jsonOutPath) {
    fs.writeFileSync(
      jsonOutPath,
      JSON.stringify({ generatedAt: new Date().toISOString(), counts, rows }, null, 2),
      "utf8"
    );
    console.log("\nПолный отчёт:", jsonOutPath);
  }

  console.log(
    "\nПодсказка: json_ok_db_empty → npm run mennica:import; no_url_in_json → перепарсить PDP или править fetch-mennica-product.js"
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
