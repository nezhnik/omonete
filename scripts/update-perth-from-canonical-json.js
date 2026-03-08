/**
 * Обновляет записи Perth в БД из канонических JSON (с source_url с сайта Perth).
 * Сопоставление и проверка ТОЛЬКО по source_url (без catalog_number), чтобы избежать
 * перезаписи многих строк одним каноником. Один URL = один продукт = одна строка.
 * Записи без source_url не обновляются (импорт с source_url или restore-159-overwritten-perth.js).
 *
 * Запуск:
 *   node scripts/update-perth-from-canonical-json.js       — обновить БД
 *   node scripts/update-perth-from-canonical-json.js --dry — только показать, что изменится
 */
require("dotenv").config({ path: ".env" });
const mysql = require("mysql2/promise");
const fs = require("fs");
const path = require("path");
const { roundSpec, normalizeWeightG, formatWeightG } = require("./format-coin-characteristics.js");

const DATA_DIR = path.join(__dirname, "..", "data");

function getConfig() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL не задан");
  const m = url.match(/mysql:\/\/([^:]+):([^@]+)@([^:]+):(\d+)\/(.+)/);
  if (!m) throw new Error("Неверный формат DATABASE_URL");
  const [, user, password, host, port, database] = m;
  return { host, port: parseInt(port, 10), user, password, database };
}

function trim(s) {
  return s != null && typeof s === "string" ? s.trim() || null : null;
}

function normalizeSourceUrl(url) {
  const s = trim(url);
  return s ? s.replace(/\/+$/, "") : null;
}

async function main() {
  const dryRun = process.argv.includes("--dry");
  if (dryRun) console.log("Режим --dry: изменения не применяются.\n");

  if (!fs.existsSync(DATA_DIR)) {
    console.error("Папка data не найдена");
    process.exit(1);
  }
  const allFiles = fs.readdirSync(DATA_DIR)
    .filter((f) => f.startsWith("perth-mint-") && f.endsWith(".json"))
    .map((f) => path.join(DATA_DIR, f));

  // Только по source_url: один URL = один каноник (повторений нет)
  const bySourceUrl = {};
  for (const filePath of allFiles) {
    let raw, c;
    try {
      raw = JSON.parse(fs.readFileSync(filePath, "utf8"));
      c = raw?.coin;
      if (!c) continue;
    } catch {
      continue;
    }
    const norm = normalizeSourceUrl(c.source_url);
    if (!norm || !String(c.source_url || "").includes("perthmint.com")) continue;
    const entry = { filePath, raw, c };
    bySourceUrl[norm] = entry;
  }
  console.log("Каноников с source_url (perthmint.com):", Object.keys(bySourceUrl).length);

  const conn = await mysql.createConnection(getConfig());
  const [rows] = await conn.execute(
    `SELECT id, catalog_number, title, title_en, series, country, face_value, mint, mint_short,
            image_obverse, image_reverse, image_box, image_certificate, source_url
     FROM coins WHERE (mint LIKE '%Perth%' OR mint_short LIKE '%Perth%') ORDER BY id`
  );

  // Инвариант: у каждой монеты уникальный source_url. Дубли (несколько строк с одним URL) — ошибка, удаляем лишние.
  const rowIdsBySourceUrl = {};
  for (const row of rows) {
    const url = normalizeSourceUrl(row.source_url);
    if (url) {
      if (!rowIdsBySourceUrl[url]) rowIdsBySourceUrl[url] = [];
      rowIdsBySourceUrl[url].push(row.id);
    }
  }

  let updated = 0;
  const idsToDelete = [];
  for (const row of rows) {
    const rowSourceUrl = normalizeSourceUrl(row.source_url);
    let canon = rowSourceUrl ? bySourceUrl[rowSourceUrl] || null : null;
    if (!canon) continue;
    // Если с этим URL несколько строк — оставляем одну (min id), остальные удаляем.
    if (rowIdsBySourceUrl[rowSourceUrl] && rowIdsBySourceUrl[rowSourceUrl].length > 1) {
      const primaryId = Math.min(...rowIdsBySourceUrl[rowSourceUrl]);
      if (row.id !== primaryId) {
        idsToDelete.push(row.id);
        continue;
      }
    }

    const c = canon.c;
    const raw = canon.raw;
    const title = (c.title_ru && c.title_ru.trim()) ? c.title_ru.trim() : (c.title || "").trim();
    const titleEn = (c.title || "").trim();
    const releaseDateVal = (() => {
      const v = c.release_date;
      if (v == null || v === "") return null;
      const s = String(v).trim();
      if (/^(20\d{2}|19\d{2})$/.test(s)) return s + "-01-01";
      if (/^(20\d{2}|19\d{2})-\d{2}-\d{2}$/.test(s)) return s;
      return v;
    })();
    const specWeight = raw?.specs?.["Minimum Gross Weight (g)"] || raw?.specs?.["Maximum Gross Weight (g)"];
    const weightGNum = normalizeWeightG(specWeight ? parseFloat(String(specWeight).replace(",", ".")) : c.weight_g) ?? c.weight_g;
    const weightGForDb = weightGNum != null ? (formatWeightG(weightGNum) ?? String(weightGNum)) : null;

    const canonCountry = trim(c.country) || null;
    const canonMint = trim(c.mint) || null;
    const canonMintShort = trim(c.mint_short) || null;
    const canonObv = trim(c.image_obverse) || null;
    const canonRev = trim(c.image_reverse) || null;
    const canonBox = trim(c.image_box) || null;
    const canonCert = trim(c.image_certificate) || null;
    const canonSourceUrl = trim(c.source_url) || null;
    const canonSeries = trim(c.series) || null;
    const canonFaceValue = trim(c.face_value) || null;

    const dbCountry = trim(row.country) || null;
    const dbMint = trim(row.mint) || null;
    const dbMintShort = trim(row.mint_short) || null;
    const dbObv = trim(row.image_obverse) || null;
    const dbRev = trim(row.image_reverse) || null;
    const dbBox = trim(row.image_box) || null;
    const dbCert = trim(row.image_certificate) || null;
    const dbSourceUrl = trim(row.source_url) || null;
    const dbSeries = trim(row.series) || null;
    const dbFaceValue = trim(row.face_value) || null;
    const dbTitle = trim(row.title) || null;

    const needUpdate =
      dbTitle !== title ||
      dbSeries !== canonSeries ||
      dbCountry !== canonCountry ||
      dbMint !== canonMint ||
      dbMintShort !== canonMintShort ||
      dbFaceValue !== canonFaceValue ||
      dbObv !== canonObv ||
      dbRev !== canonRev ||
      dbBox !== canonBox ||
      dbCert !== canonCert ||
      dbSourceUrl !== canonSourceUrl;

    if (!needUpdate) continue;

    if (dryRun) {
      console.log("Обновить id=" + row.id + " " + (row.title || "").slice(0, 50));
      if (dbCountry !== canonCountry) console.log("  country: " + dbCountry + " -> " + canonCountry);
      if (dbMint !== canonMint || dbMintShort !== canonMintShort) console.log("  mint: " + dbMint + " -> " + canonMint);
      if (dbObv !== canonObv) console.log("  image_obverse: ... -> " + (canonObv ? canonObv.slice(-40) : "null"));
      if (dbRev !== canonRev) console.log("  image_reverse: ... -> " + (canonRev ? canonRev.slice(-40) : "null"));
      if (dbSourceUrl !== canonSourceUrl) console.log("  source_url: " + (dbSourceUrl ? "был" : "не было") + " -> " + (canonSourceUrl ? "есть" : "нет"));
      updated++;
      continue;
    }

    await conn.execute(
      `UPDATE coins SET
        title = ?, series = ?, country = ?, face_value = ?, mint = ?, mint_short = ?,
        image_obverse = ?, image_reverse = ?, image_box = ?, image_certificate = ?,
        source_url = ?, release_date = ?, weight_g = ?
       WHERE id = ?`,
      [
        title || dbTitle || "Perth Mint",
        canonSeries,
        canonCountry || "Австралия",
        canonFaceValue,
        canonMint || "The Perth Mint",
        canonMintShort || "Perth Mint",
        canonObv,
        canonRev,
        canonBox,
        canonCert,
        canonSourceUrl,
        releaseDateVal,
        weightGForDb,
        row.id,
      ]
    );
    updated++;
    console.log("  обновлён id=" + row.id + " " + (c.title || "").slice(0, 45));
  }

  // Удаляем дубли по source_url — ошибочные записи не держим
  const COINS_JSON_DIR = path.join(__dirname, "..", "public", "data", "coins");
  if (!dryRun && idsToDelete.length > 0) {
    const placeholders = idsToDelete.map(() => "?").join(",");
    await conn.execute("DELETE FROM coins WHERE id IN (" + placeholders + ")", idsToDelete);
    console.log("  Удалено дублей по source_url:", idsToDelete.length, "id:", idsToDelete.slice(0, 10).join(", ") + (idsToDelete.length > 10 ? " …" : ""));
    for (const id of idsToDelete) {
      const f = path.join(COINS_JSON_DIR, id + ".json");
      if (fs.existsSync(f)) {
        fs.unlinkSync(f);
      }
    }
  }

  await conn.end();
  console.log("\n✓ Обновлено записей из канонического JSON:", updated);
  if ((updated > 0 || idsToDelete.length > 0) && !dryRun) {
    console.log("Дальше: npm run data:export:incremental && npm run build");
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
