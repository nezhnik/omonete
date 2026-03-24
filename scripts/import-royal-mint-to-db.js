/**
 * Импорт монет The Royal Mint из data/royal-mint-*.json в таблицу coins.
 *
 * Как у Perth: ключ — страница товара (source_url). В БД пишем канонический URL без ?query и #hash,
 * поиск существующей строки — по каноническому URL и по «старому» виду (с query), чтобы обновить зомби.
 *
 * JSON с source_url в разделе Trial of the Pyx (/trial-of-the-pyx/) не импортируются.
 *
 * Fallback по catalog_number только с флагом --match-catalog (миграции).
 *
 * Запуск:
 *   node scripts/import-royal-mint-to-db.js
 *   node scripts/import-royal-mint-to-db.js --purge-404     — удалить строки Royal Mint с title 404 (перед импортом)
 *   node scripts/import-royal-mint-to-db.js --match-catalog — дополнительно искать по catalog_number
 *   node scripts/import-royal-mint-to-db.js --no-db-spec-collision-check — не писать предупреждения о совпадении спек с БД
 *   node scripts/import-royal-mint-to-db.js --allow-trial-of-pyx — импортировать JSON с PDP Trial of the Pyx (после fetch с тем же флагом)
 *
 * Перед INSERT новой строки: сверка с БД по год+вес+металл+тираж (все заданы с обеих сторон). Совпадение
 * не отменяет вставку; строка в data/royal-mint-spec-collision-review.jsonl и предупреждение в консоль.
 *   node scripts/import-royal-mint-to-db.js data/royal-mint-slug.json
 *
 * Дальше: npm run data:export
 */
require("dotenv").config({ path: ".env" });
const mysql = require("mysql2/promise");
const fs = require("fs");
const path = require("path");
const { roundSpec, normalizeWeightG, formatWeightG } = require("./format-coin-characteristics.js");
const { isRoyalMintTrialOfPyxUrl } = require("./royal-mint-listing-collect.js");

const DATA_DIR = path.join(__dirname, "..", "data");

function getConfig() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL не задан в .env");
    process.exit(1);
  }
  const m = url.match(/mysql:\/\/([^:]+):([^@]+)@([^:]+):(\d+)\/(.+)/);
  if (!m) {
    console.error("Неверный формат DATABASE_URL");
    process.exit(1);
  }
  const [, user, password, host, port, database] = m;
  return { host, port: parseInt(port, 10), user, password, database };
}

function normalizeSourceUrl(url) {
  if (url == null || typeof url !== "string") return null;
  return url.trim().replace(/\/+$/, "") || null;
}

/**
 * Канонический PDP Royal Mint: без query/hash, без завершающего слэша — одна монета = один URL.
 */
function canonicalRoyalMintProductUrl(url) {
  if (url == null || typeof url !== "string") return null;
  const s = url.trim();
  if (!s) return null;
  try {
    const u = new URL(s);
    if (!/royalmint\.com/i.test(u.hostname)) return null;
    u.hash = "";
    u.search = "";
    const p = u.pathname.replace(/\/+$/, "") || "";
    return `${u.origin}${p}`.replace(/\/+$/, "");
  } catch {
    const noQuery = s.split("#")[0].split("?")[0].replace(/\/+$/, "");
    return /royalmint\.com/i.test(noQuery) ? noQuery : null;
  }
}

/** Укладываемся в VARCHAR(64); длинный код из JSON если ≤64. */
function catalogNumberForDb(c, filePath) {
  const slugFromFile = path.basename(filePath, ".json").replace(/^royal-mint-/, "");
  const shortCode = (slugFromFile.split("-")[0] || slugFromFile).replace(/[^a-z0-9]/gi, "").toUpperCase();
  const shortCat = `GB-ROYAL-${shortCode}`.slice(0, 64);
  const fromJson = (c.catalog_number && String(c.catalog_number).trim()) || "";
  if (fromJson.length > 0 && fromJson.length <= 64) return fromJson;
  return shortCat;
}

const ROYAL_CATALOG_MATCH =
  "(mint LIKE '%Royal Mint%' OR mint_short LIKE '%Royal Mint%' OR catalog_number LIKE 'GB-ROYAL-%')";

function parseFlags(argv) {
  const purge404 = argv.includes("--purge-404");
  const matchCatalog = argv.includes("--match-catalog");
  const noDbSpecCollision = argv.includes("--no-db-spec-collision-check");
  const allowTrialOfPyx = argv.includes("--allow-trial-of-pyx");
  const arg = argv.find((a) => !a.startsWith("--") && a.endsWith(".json"));
  return { purge404, matchCatalog, noDbSpecCollision, allowTrialOfPyx, arg };
}

async function main() {
  const argv = process.argv.slice(2);
  const { purge404, matchCatalog, noDbSpecCollision, allowTrialOfPyx, arg } = parseFlags(argv);

  let files = [];
  if (arg) {
    const p = path.isAbsolute(arg) ? arg : path.join(process.cwd(), arg);
    if (!fs.existsSync(p)) {
      console.error("Файл не найден:", p);
      process.exit(1);
    }
    files = [p];
  } else {
    if (!fs.existsSync(DATA_DIR)) {
      console.error("Папка data не найдена");
      process.exit(1);
    }
    const all = fs
      .readdirSync(DATA_DIR)
      .filter(
        (f) =>
          f.startsWith("royal-mint-") &&
          f.endsWith(".json") &&
          !f.includes("skipped") &&
          !f.includes("verify") &&
          !f.includes("progress") &&
          !f.includes("listing-products") &&
          !f.includes("probe")
      )
      .sort();

    /** Одна запись на канонический source_url (приоритет первого файла по имени). */
    const byCanon = new Map();
    for (const f of all) {
      const fp = path.join(DATA_DIR, f);
      let raw;
      try {
        raw = JSON.parse(fs.readFileSync(fp, "utf8"));
      } catch {
        continue;
      }
      const c = raw.coin;
      if (!c?.source_url || !/royalmint\.com/i.test(String(c.source_url))) continue;
      const k = canonicalRoyalMintProductUrl(c.source_url);
      if (!k) continue;
      if (!byCanon.has(k)) byCanon.set(k, fp);
    }
    files = [...byCanon.values()];
    console.log("Файлов royal-mint-*.json (уникальных по каноническому source_url):", files.length);
  }

  if (files.length === 0) {
    console.error("Нет файлов royal-mint-*.json в data/ (или укажи путь к одному файлу).");
    process.exit(1);
  }

  let hasTitleEn = false;
  const conn = await mysql.createConnection(getConfig());

  try {
    const [cols] = await conn.execute(
      "SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'coins' AND COLUMN_NAME = 'title_en'"
    );
    hasTitleEn = cols.length > 0;
  } catch {
    /* ignore */
  }

  if (purge404) {
    const cond404 = hasTitleEn
      ? `(title LIKE '%404 PAGE NOT FOUND%' OR title LIKE '%404 page not found%'
        OR title_en LIKE '%404 PAGE NOT FOUND%' OR title_en LIKE '%404 page not found%')`
      : `(title LIKE '%404 PAGE NOT FOUND%' OR title LIKE '%404 page not found%')`;
    const [res] = await conn.execute(`DELETE FROM coins WHERE (${ROYAL_CATALOG_MATCH}) AND ${cond404}`);
    console.log("Удалено строк Royal Mint с 404 в title:", res.affectedRows);
  }

  const colsBase = [
    "title",
    "title_en",
    "series",
    "country",
    "face_value",
    "mint",
    "mint_short",
    "metal",
    "metal_fineness",
    "mintage",
    "mintage_display",
    "weight_g",
    "weight_oz",
    "release_date",
    "catalog_number",
    "catalog_suffix",
    "quality",
    "diameter_mm",
    "thickness_mm",
    "length_mm",
    "width_mm",
    "image_obverse",
    "image_reverse",
    "image_blister_reverse",
    "image_blister_obverse",
    "image_box",
    "image_certificate",
    "price_display",
    "source_url",
  ];
  const cols = hasTitleEn ? colsBase : colsBase.filter((k) => k !== "title_en");

  let inserted = 0;
  let updated = 0;

  const updateCols = cols.filter((k) => k !== "catalog_number");
  const setClause = updateCols.map((k) => `${k} = ?`).join(", ");

  const total = files.length;
  for (let i = 0; i < files.length; i++) {
    const filePath = files[i];
    if (i > 0 && i % 30 === 0) process.stdout.write(`  [${i}/${total}] …\n`);

    let raw;
    try {
      raw = JSON.parse(fs.readFileSync(filePath, "utf8"));
    } catch (e) {
      console.warn("  Пропуск (битый JSON):", filePath, e.message);
      continue;
    }
    const c = raw.coin;
    if (!c) {
      console.warn("  Пропуск (нет .coin):", filePath);
      continue;
    }

    const catalogNumber = catalogNumberForDb(c, filePath);
    if (!catalogNumber) {
      console.warn("  Пропуск (нет catalog_number):", filePath);
      continue;
    }

    const canon = canonicalRoyalMintProductUrl(c.source_url);
    if (!canon) {
      console.warn("  Пропуск (нет source_url royalmint.com):", filePath);
      continue;
    }
    if (
      !allowTrialOfPyx &&
      (isRoyalMintTrialOfPyxUrl(canon) || isRoyalMintTrialOfPyxUrl(c.source_url))
    ) {
      console.warn("  Пропуск (Trial of the Pyx, не импортируем):", filePath);
      continue;
    }
    const legacyTrim = normalizeSourceUrl(c.source_url);

    const title = (c.title_ru && c.title_ru.trim()) ? c.title_ru.trim() : (c.title || "").trim();
    const titleEn = (c.title || "").trim();

    const releaseDateVal = (() => {
      const v = c.release_date;
      if (v == null || v === "") return null;
      const s = String(v).trim();
      if (/^(20\d{2}|19\d{2})$/.test(s)) return `${s}-01-01`;
      if (/^(20\d{2}|19\d{2})-\d{2}-\d{2}$/.test(s)) return s;
      return v;
    })();

    const weightGNum = normalizeWeightG(c.weight_g) ?? c.weight_g;
    const weightGForDb = weightGNum != null ? formatWeightG(weightGNum) ?? String(weightGNum) : null;

    const values = [
      title || titleEn || "The Royal Mint",
      ...(hasTitleEn ? [titleEn || null] : []),
      c.series || null,
      (c.country && String(c.country).trim() !== "" ? c.country : null),
      c.face_value || null,
      c.mint || "The Royal Mint",
      c.mint_short || "Royal Mint",
      c.metal || "Серебро",
      c.metal_fineness != null ? String(c.metal_fineness).trim() : null,
      c.mintage != null ? c.mintage : null,
      c.mintage_display != null ? c.mintage_display : null,
      weightGForDb,
      c.weight_oz != null ? c.weight_oz : null,
      releaseDateVal,
      catalogNumber,
      (c.catalog_suffix || "").trim() || null,
      c.quality || null,
      c.diameter_mm != null ? roundSpec(c.diameter_mm) ?? c.diameter_mm : null,
      c.thickness_mm != null ? roundSpec(c.thickness_mm) ?? c.thickness_mm : null,
      c.length_mm != null ? roundSpec(c.length_mm) ?? c.length_mm : null,
      c.width_mm != null ? roundSpec(c.width_mm) ?? c.width_mm : null,
      (c.image_obverse || "").trim() || null,
      (c.image_reverse || "").trim() || null,
      (c.image_blister_reverse || "").trim() || null,
      (c.image_blister_obverse || "").trim() || null,
      (c.image_box || "").trim() || null,
      (c.image_certificate || "").trim() || null,
      (c.price_display && String(c.price_display).trim()) || null,
      canon,
    ];

    let existing = [];
    const [bySource] = await conn.execute(
      `SELECT id FROM coins WHERE (${ROYAL_CATALOG_MATCH}) AND (
        source_url = ? OR source_url = ? OR
        TRIM(TRAILING '/' FROM SUBSTRING_INDEX(IFNULL(source_url,''), '?', 1)) = ?
      ) LIMIT 2`,
      [canon, legacyTrim || canon, canon]
    );
    existing = bySource;

    if (existing.length > 1) {
      console.warn("  [пропуск] несколько строк на один PDP:", canon, "—", existing.length);
      continue;
    }

    if (existing.length === 0 && matchCatalog && catalogNumber) {
      const [byCatalog] = await conn.execute(
        `SELECT id FROM coins WHERE catalog_number = ? AND ${ROYAL_CATALOG_MATCH}`,
        [catalogNumber]
      );
      if (byCatalog.length > 1) {
        console.warn(
          "  [пропуск] catalog_number " + catalogNumber + " — " + byCatalog.length + " записей, не обновляем."
        );
        continue;
      }
      if (byCatalog.length === 1) existing = byCatalog;
    }

    if (existing.length > 0) {
      const catalogIdx = cols.indexOf("catalog_number");
      const updateValues = [...values.slice(0, catalogIdx), ...values.slice(catalogIdx + 1), existing[0].id];
      await conn.execute(`UPDATE coins SET ${setClause} WHERE id = ?`, updateValues);
      updated++;
      console.log("  ~", catalogNumber, title || titleEn);
      continue;
    }

    const skipCollision =
      noDbSpecCollision || process.env.RM_SKIP_DB_SPEC_DUPLICATE_CHECK === "1";
    if (!skipCollision) {
      try {
        const { checkRoyalMintSpecCollisions } = require("./royal-mint-spec-duplicate-lib.js");
        const coinForCheck = { ...c, title_en: c.title_en != null ? c.title_en : c.title };
        const { duplicate_review } = await checkRoyalMintSpecCollisions(conn, coinForCheck, raw.specs || {}, {
          stage: "import",
        });
        if (duplicate_review) {
          console.warn("  [!] INSERT: в БД уже есть монета с теми же год/вес/металл/тираж —", (title || titleEn).slice(0, 52));
          console.warn("      См. data/royal-mint-spec-collision-review.jsonl (вставка не отменена).");
        }
      } catch (e) {
        console.warn("  [!] Проверка spec-collision:", e.message);
      }
    }

    const placeholders = cols.map(() => "?").join(", ");
    await conn.execute(`INSERT INTO coins (${cols.join(", ")}) VALUES (${placeholders})`, values);
    inserted++;
    console.log("  +", catalogNumber, title || titleEn);
  }

  await conn.end();
  console.log("\n✓ Royal Mint: добавлено", inserted, ", обновлено", updated);
  console.log("Импорт по каноническому source_url (без ?query). Fallback catalog:", matchCatalog ? "да" : "нет (флаг --match-catalog).");
  if (inserted > 0 || updated > 0 || purge404) {
    console.log("Дальше: npm run data:export (или data:export:incremental).");
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
