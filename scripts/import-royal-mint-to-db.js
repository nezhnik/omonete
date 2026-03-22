/**
 * Импорт монет The Royal Mint из data/royal-mint-*.json в таблицу coins (как Perth).
 * Поиск строки: сначала source_url (royalmint.com), иначе catalog_number + префикс GB-ROYAL- / двор Royal Mint.
 * catalog_number в БД не длиннее 64 символов (как в схеме); длинный код из JSON заменяется на GB-ROYAL-<код из имени файла>.
 *
 * Запуск:
 *   node scripts/import-royal-mint-to-db.js
 *   node scripts/import-royal-mint-to-db.js data/royal-mint-slug.json
 *
 * Дальше: npm run data:export (или data:export:incremental) — монета попадёт в public/data/coins/.
 */
require("dotenv").config({ path: ".env" });
const mysql = require("mysql2/promise");
const fs = require("fs");
const path = require("path");
const { roundSpec, normalizeWeightG, formatWeightG } = require("./format-coin-characteristics.js");

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

/** Укладываемся в VARCHAR(64); уникальность — по slug (первый сегмент = SKU в URL RM). */
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

async function main() {
  let files = [];
  const arg = process.argv[2];
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
    files = fs
      .readdirSync(DATA_DIR)
      .filter(
        (f) =>
          f.startsWith("royal-mint-") &&
          f.endsWith(".json") &&
          !f.includes("skipped") &&
          !f.includes("verify") &&
          !f.includes("progress")
      )
      .map((f) => path.join(DATA_DIR, f));
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

    const sourceUrlNorm = normalizeSourceUrl(c.source_url);
    if (!sourceUrlNorm || !/royalmint\.com/i.test(sourceUrlNorm)) {
      console.warn("  Пропуск (нет source_url royalmint.com):", filePath);
      continue;
    }

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
      sourceUrlNorm,
    ];

    let existing = [];
    const [bySource] = await conn.execute("SELECT id FROM coins WHERE source_url = ? LIMIT 1", [sourceUrlNorm]);
    existing = bySource;

    if (existing.length === 0 && catalogNumber) {
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

    const placeholders = cols.map(() => "?").join(", ");
    await conn.execute(`INSERT INTO coins (${cols.join(", ")}) VALUES (${placeholders})`, values);
    inserted++;
    console.log("  +", catalogNumber, title || titleEn);
  }

  await conn.end();
  console.log("\n✓ Royal Mint: добавлено", inserted, ", обновлено", updated);
  if (inserted > 0 || updated > 0) {
    console.log("Дальше: npm run data:export (или npm run data:export:incremental), затем при необходимости npm run build.");
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
