/**
 * Mennica: меняет местами содержимое пар *-obv.webp ↔ *-rev.webp на диске (тройной rename).
 * Пути в БД не меняются — как pamp-swap-obv-rev-webp-files.js.
 *
 * Контракт и отличие от правки JSON: docs/PARSING-CONTRACT.md §9.5.
 *
 * Охват: монеты с source_url inwestycje.mennica.com.pl, не слитки PL-MENNICA-GOLD-BAR-*,
 * не id из SKIP_COIN_IDS. Блистерные пары не трогаем.
 *
 * По умолчанию без --apply = dry-run (только план в консоль).
 *   node scripts/swap-mennica-obv-rev-webp-files.js
 *   node scripts/swap-mennica-obv-rev-webp-files.js --apply
 *
 * Только перечисленные id (игнорируется SKIP_COIN_IDS; слитки по-прежнему пропускаются):
 *   node scripts/swap-mennica-obv-rev-webp-files.js --only-ids=7100,7101 --apply
 */
require("dotenv").config({ path: ".env" });
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const mysql = require("mysql2/promise");

const FOREIGN_DIR = path.join(__dirname, "..", "public", "image", "coins", "foreign");

/** Не менять obv/rev файлы для этих монет (список редактора). */
const SKIP_COIN_IDS = new Set(
  [
    7053, 7021, 7120, 7099, 7095, 7077, 7038, 7189, 7167, 7175, 7176, 7130, 7128, 7104, 7060, 7032,
    7022, 7195, 7194, 7178, 7159, 7139, 7149, 7156, 7070, 7072, 7065, 7046, 7036, 7031,
  ].map(Number)
);

function getConfig() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL не задан");
  const m = url.match(/mysql:\/\/([^:]+):([^@]+)@([^:]+):(\d+)\/(.+)/);
  if (!m) throw new Error("Неверный формат DATABASE_URL");
  const [, user, password, host, port, database] = m;
  return { host, port: Number(port), user, password, database };
}

function foreignBasename(webPath) {
  if (!webPath || typeof webPath !== "string") return null;
  const s = webPath.trim();
  const idx = s.indexOf("/foreign/");
  if (idx === -1) return null;
  const rest = s.slice(idx + "/foreign/".length).split("/").pop();
  if (!rest || !/\.webp$/i.test(rest) || rest.includes("..")) return null;
  return rest;
}

/** Одна пара mennica-{slug}-obv / rev с общим slug, без blister в имени. */
function mennicaMainObvRevPair(obvPath, revPath) {
  const oBase = foreignBasename(obvPath);
  const rBase = foreignBasename(revPath);
  if (!oBase || !rBase) return null;
  if (/blister/i.test(oBase) || /blister/i.test(rBase)) return null;
  const mo = oBase.match(/^(mennica-.+)-obv\.webp$/i);
  const mr = rBase.match(/^(mennica-.+)-rev\.webp$/i);
  if (!mo || !mr) return null;
  if (mo[1].toLowerCase() !== mr[1].toLowerCase()) return null;
  return { obvBase: oBase, revBase: rBase };
}

/** @returns {number[] | null} — null если флага нет; иначе непустой массив id */
function parseOnlyIdsArg() {
  const raw = process.argv.find((a) => a.startsWith("--only-ids="));
  if (!raw) return null;
  const part = raw.slice("--only-ids=".length).trim();
  const ids = part
    .split(/[,;\s]+/)
    .map((s) => parseInt(String(s).trim(), 10))
    .filter((n) => Number.isFinite(n) && n > 0);
  if (!ids.length) {
    console.error("Укажите хотя бы один числовой id: --only-ids=7100,7101");
    process.exit(1);
  }
  return ids;
}

function swapPair(obvBase, revBase, label, dryRun) {
  const obv = path.join(FOREIGN_DIR, obvBase);
  const rev = path.join(FOREIGN_DIR, revBase);
  if (!fs.existsSync(obv) || !fs.existsSync(rev)) {
    console.warn("Пропуск (нет файлов):", label, obvBase, revBase);
    return false;
  }
  if (dryRun) {
    console.log("[dry-run] swap:", label, obvBase, "↔", revBase);
    return true;
  }
  const tmp = path.join(FOREIGN_DIR, `.swap-${crypto.randomBytes(8).toString("hex")}-${obvBase}`);
  fs.renameSync(obv, tmp);
  fs.renameSync(rev, obv);
  fs.renameSync(tmp, rev);
  console.log("OK:", label, obvBase, "↔", revBase);
  return true;
}

async function main() {
  const dryRun = !process.argv.includes("--apply");
  const onlyIds = parseOnlyIdsArg();
  if (dryRun) console.log("Режим dry-run (без записи на диск). Для применения: --apply\n");
  if (onlyIds) {
    console.log("Режим --only-ids:", onlyIds.join(", "), "(SKIP_COIN_IDS не применяется к этим id)\n");
  }

  if (!fs.existsSync(FOREIGN_DIR)) {
    console.error("Нет каталога:", FOREIGN_DIR);
    process.exit(1);
  }

  const conn = await mysql.createConnection(getConfig());
  try {
    let sql = `SELECT id, catalog_number, source_url, image_obverse, image_reverse
       FROM coins
       WHERE source_url IS NOT NULL
         AND source_url LIKE '%inwestycje.mennica.com.pl%'`;
    const params = [];
    if (onlyIds) {
      sql += ` AND id IN (${onlyIds.map(() => "?").join(", ")})`;
      params.push(...onlyIds);
    }
    const [rows] = await conn.execute(sql, params);

    let swapped = 0;
    let skipped = 0;

    for (const r of rows) {
      const id = Number(r.id);
      const restrictToOnly = onlyIds != null;
      if (!restrictToOnly && SKIP_COIN_IDS.has(id)) {
        skipped++;
        continue;
      }
      const cat = String(r.catalog_number || "").trim();
      if (/^PL-MENNICA-GOLD-BAR-/i.test(cat)) {
        skipped++;
        continue;
      }

      const obv = r.image_obverse && String(r.image_obverse).trim();
      const rev = r.image_reverse && String(r.image_reverse).trim();
      if (!obv || !rev) {
        skipped++;
        continue;
      }

      const pair = mennicaMainObvRevPair(obv, rev);
      if (!pair) {
        skipped++;
        continue;
      }

      if (swapPair(pair.obvBase, pair.revBase, `id=${r.id}`, dryRun)) swapped++;
      else skipped++;
    }

    console.log("—");
    console.log("Строк в выборке:", rows.length);
    console.log(dryRun ? "Запланировано обменов пар:" : "Обменено пар:", swapped);
    console.log("Пропусков (исключения, нет пары путей, нет файлов):", skipped);
  } finally {
    await conn.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
