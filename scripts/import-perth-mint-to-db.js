/**
 * Импорт монет Perth Mint из data/perth-mint-*.json в таблицу coins.
 * Приоритет: для одного catalog_number используется канонический JSON с сайта (тот, где задан source_url страницы товара Perth).
 * Так страна, картинки и название не перезаписываются данными из «короткого» JSON без URL.
 * Поиск существующей записи: сначала по source_url, при отсутствии — по catalog_number (Perth). UPDATE или INSERT.
 *
 * Запуск:
 *   node scripts/import-perth-mint-to-db.js              — все data/perth-mint-*.json (по source_url: обновить или вставить)
 *   node scripts/import-perth-mint-to-db.js --replace-perth — удалить старые Perth без source_url, затем импорт (чтобы не было дублей после смены логики)
 *   node scripts/import-perth-mint-to-db.js путь/к/file.json — один файл
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

async function main() {
  let files = [];
  const replacePerth = process.argv.includes("--replace-perth");
  const arg = process.argv.filter((a) => a !== "--replace-perth")[2];
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
    files = fs.readdirSync(DATA_DIR)
      .filter((f) => f.startsWith("perth-mint-") && f.endsWith(".json"))
      .map((f) => path.join(DATA_DIR, f));
  }

  if (files.length === 0) {
    console.error("Нет файлов perth-mint-*.json в data/ или указанный файл не найден.");
    process.exit(1);
  }

  // Приоритет канонического JSON с сайта: для одного catalog_number берём файл, где есть source_url (страница товара Perth).
  // Так не перезаписываем правильные данные (страна, картинки, название) данными из «короткого» JSON без URL.
  if (files.length > 1 && !arg) {
    const byCatalog = {};
    for (const filePath of files) {
      let raw, c, catalogNumber;
      try {
        raw = JSON.parse(fs.readFileSync(filePath, "utf8"));
        c = raw?.coin;
        if (!c) continue;
        const slugFromFile = path.basename(filePath, ".json").replace(/^perth-mint-/, "");
        catalogNumber = (c.catalog_number && String(c.catalog_number).trim()) || (slugFromFile ? "AU-PERTH-" + slugFromFile : null);
        if (!catalogNumber) continue;
      } catch {
        continue;
      }
      const hasSourceUrl = !!(c.source_url && String(c.source_url).trim() && c.source_url.includes("perthmint.com"));
      const prev = byCatalog[catalogNumber];
      if (!prev || (hasSourceUrl && !prev.hasSourceUrl) || (hasSourceUrl && prev.hasSourceUrl && (c.source_url || "").length > (prev.sourceUrlLen || 0))) {
        byCatalog[catalogNumber] = { filePath, hasSourceUrl, sourceUrlLen: (c.source_url || "").length };
      }
    }
    files = [...new Set(Object.values(byCatalog).map((x) => x.filePath))];
    console.log("Используем канонический JSON (с source_url) при дубликате catalog_number, файлов к импорту:", files.length);
  }

  let hasTitleEn = false;
  const conn = await mysql.createConnection(getConfig());
  try {
    const [cols] = await conn.execute(
      "SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'coins' AND COLUMN_NAME = 'title_en'"
    );
    hasTitleEn = cols.length > 0;
  } catch {
    // ignore
  }

  const colsBase = [
    "title", "title_en", "series", "country", "face_value", "mint", "mint_short",
    "metal", "metal_fineness", "mintage", "mintage_display", "weight_g", "weight_oz",
    "release_date", "catalog_number", "catalog_suffix", "quality",
    "diameter_mm", "thickness_mm", "length_mm", "width_mm", "image_obverse", "image_reverse", "image_box", "image_certificate",
    "price_display", "source_url"
  ];
  const cols = hasTitleEn ? colsBase : colsBase.filter((k) => k !== "title_en");

  let inserted = 0;
  let updated = 0;

  const updateCols = cols.filter((k) => k !== "catalog_number");
  const setClause = updateCols.map((k) => `${k} = ?`).join(", ");

  if (replacePerth) {
    const [res] = await conn.execute(
      "DELETE FROM coins WHERE (mint LIKE '%Perth%' OR mint_short LIKE '%Perth%') AND (source_url IS NULL OR source_url = '')"
    );
    console.log("Удалено старых Perth (без source_url):", res.affectedRows);
  }

  for (const filePath of files) {
    const raw = JSON.parse(fs.readFileSync(filePath, "utf8"));
    const c = raw.coin;
    if (!c) {
      console.warn("  Пропуск (нет .coin):", filePath);
      continue;
    }
    if (c.title && c.title.includes("blocked")) {
      console.warn("  Пропуск (страница блокировки):", filePath);
      continue;
    }

    const slugFromFile = path.basename(filePath, ".json").replace(/^perth-mint-/, "");
    const catalogNumber = (c.catalog_number && String(c.catalog_number).trim()) || (slugFromFile ? "AU-PERTH-" + slugFromFile : null);
    if (!catalogNumber) {
      console.warn("  Пропуск (не удалось определить catalog_number):", filePath);
      continue;
    }

    const title = (c.title_ru && c.title_ru.trim()) ? c.title_ru.trim() : (c.title || "").trim();
    const titleEn = (c.title || "").trim();
    // Год в БД как DATE (YYYY-01-01), как у российских монет; если пришёл только год — нормализуем
    const releaseDateVal = (() => {
      const v = c.release_date;
      if (v == null || v === "") return null;
      const s = String(v).trim();
      if (/^(20\d{2}|19\d{2})$/.test(s)) return s + "-01-01";
      if (/^(20\d{2}|19\d{2})-\d{2}-\d{2}$/.test(s)) return s;
      return v;
    })();

    const specWeight = raw.specs?.["Minimum Gross Weight (g)"] || raw.specs?.["Maximum Gross Weight (g)"];
    const weightGNum = normalizeWeightG(specWeight ? parseFloat(String(specWeight).replace(",", ".")) : c.weight_g) ?? c.weight_g;
    const weightGForDb = weightGNum != null ? (formatWeightG(weightGNum) ?? String(weightGNum)) : null;

    const values = [
      title || titleEn || "Perth Mint",
      ...(hasTitleEn ? [titleEn || null] : []),
      c.series || null,
      (c.country && String(c.country).trim() !== "" ? c.country : null),
      c.face_value || null,
      c.mint || "The Perth Mint",
      c.mint_short || "Perth Mint",
      c.metal || "Серебро",
      c.metal_fineness || null,
      c.mintage != null ? c.mintage : null,
      c.mintage_display != null ? c.mintage_display : null,
      weightGForDb,
      c.weight_oz != null ? c.weight_oz : null,
      releaseDateVal,
      catalogNumber,
      (c.catalog_suffix || "").trim() || null,
      c.quality || null,
      c.diameter_mm != null ? (roundSpec(c.diameter_mm) ?? c.diameter_mm) : null,
      c.thickness_mm != null ? (roundSpec(c.thickness_mm) ?? c.thickness_mm) : null,
      c.length_mm != null ? (roundSpec(c.length_mm) ?? c.length_mm) : null,
      c.width_mm != null ? (roundSpec(c.width_mm) ?? c.width_mm) : null,
      (c.image_obverse || "").trim() || null,
      (c.image_reverse || "").trim() || null,
      (c.image_box || "").trim() || null,
      (c.image_certificate || "").trim() || null,
      (c.price_display && String(c.price_display).trim()) || null,
      (c.source_url && String(c.source_url).trim()) || null
    ];

    const sourceUrlNorm = normalizeSourceUrl(c.source_url);
    let existing = [];
    if (sourceUrlNorm) {
      const [bySource] = await conn.execute(
        "SELECT id FROM coins WHERE source_url = ? AND (mint LIKE '%Perth%' OR mint_short LIKE '%Perth%') LIMIT 1",
        [sourceUrlNorm]
      );
      existing = bySource;
    }
    // Если по source_url не нашли — ищем по catalog_number (чтобы не создавать дубль при повторном импорте без URL)
    if (existing.length === 0 && catalogNumber) {
      const [byCatalogCount] = await conn.execute(
        "SELECT id FROM coins WHERE catalog_number = ? AND (mint LIKE '%Perth%' OR mint_short LIKE '%Perth%')",
        [catalogNumber]
      );
      // Не обновлять по catalog_number, если записей несколько — иначе перезапишем не ту монету.
      if (byCatalogCount.length > 1) {
        console.warn("  [пропуск] catalog_number " + catalogNumber + " у " + byCatalogCount.length + " записей — обновление отключено. Добавьте source_url в каноник или исправьте БД.");
        continue;
      }
      if (byCatalogCount.length === 1) existing = byCatalogCount;
    }

    if (existing.length > 0) {
      const catalogIdx = cols.indexOf("catalog_number");
      const updateValues = [...values.slice(0, catalogIdx), ...values.slice(catalogIdx + 1), existing[0].id];
      await conn.execute(
        `UPDATE coins SET ${setClause} WHERE id = ?`,
        updateValues
      );
      updated++;
      console.log("  ~", catalogNumber, c.series || "(серия)", title || titleEn);
      continue;
    }

    const placeholders = cols.map(() => "?").join(", ");
    await conn.execute(
      `INSERT INTO coins (${cols.join(", ")}) VALUES (${placeholders})`,
      values
    );
    inserted++;
    console.log("  +", catalogNumber, title || titleEn);
  }

  await conn.end();
  console.log("\n✓ Perth Mint: добавлено", inserted, ", обновлено", updated);
  if (inserted > 0 || updated > 0) {
    console.log("Дальше: npm run data:export (или data:export:incremental) && npm run build — тогда монета появится в каталоге.");
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
