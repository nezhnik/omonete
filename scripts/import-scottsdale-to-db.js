/**
 * Импорт Scottsdale Mint из data/scottsdale-mint-*.json.
 * Ключ: source_url. Пропуск random-товаров по title.
 *
 * Запуск:
 *   node scripts/import-scottsdale-to-db.js
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

function isRandomTitle(title) {
  const s = String(title || "").toLowerCase();
  return /\brandom\b|\bmystery\b|\bassorted\b|\bmixed lot\b|\bgrab bag\b/.test(s);
}

function isInvalidSourceUrl(url) {
  const s = String(url || "").toLowerCase();
  return /\/product\/__trashed\/?$/.test(s);
}

function parseYearToDate(title) {
  const m = String(title || "").match(/\b(19|20)\d{2}\b/);
  return m ? `${m[0]}-01-01` : null;
}

function parseNumber(s) {
  if (s == null) return null;
  const m = String(s).replace(",", ".").match(/(\d+(?:\.\d+)?)/);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : null;
}

function parseWeight(specs) {
  const s = String(specs.Weight || "").trim();
  if (!s) return { weight_g: null, weight_oz: null };
  const n = parseNumber(s);
  if (n == null) return { weight_g: null, weight_oz: null };
  if (/oz|ounce/i.test(s)) {
    const g = Math.round(n * 31.1034768 * 100) / 100;
    return { weight_g: g, weight_oz: n };
  }
  if (/kg|kilo/i.test(s)) {
    const g = Math.round(n * 1000 * 100) / 100;
    return { weight_g: g, weight_oz: Math.round((g / 31.1034768) * 10000) / 10000 };
  }
  // По умолчанию граммы
  const g = Math.round(n * 100) / 100;
  return { weight_g: g, weight_oz: Math.round((g / 31.1034768) * 10000) / 10000 };
}

function parseMetal(specs, title) {
  const src = `${specs.Purity || ""} ${title || ""}`.toLowerCase();
  if (/silver|999\s*silver/.test(src)) return "Серебро";
  if (/gold|999\s*gold/.test(src)) return "Золото";
  if (/copper|cu\b/.test(src)) return "Медь";
  if (/platinum|pt\b/.test(src)) return "Платина";
  return null;
}

function parseFineness(specs) {
  const p = String(specs.Purity || "").trim();
  if (!p) return null;
  const m = p.match(/(\d{2,3}(?:\.\d+)?)/);
  if (!m) return null;
  const n = Number(m[1]);
  if (!Number.isFinite(n)) return null;
  if (n <= 1) return null;
  if (n < 10) return String(Math.round(n * 1000));
  if (n <= 100) return String(Math.round(n * 10));
  return String(Math.round(n));
}

function parseMintage(specs) {
  const raw = String(specs.Mintage || "").trim();
  if (!raw) return { mintage: null, mintage_display: null };
  if (/∞|infinite|unlimited/i.test(raw)) return { mintage: null, mintage_display: "Не ограничен" };
  const digits = raw.replace(/[^\d]/g, "");
  const n = digits ? Number(digits) : null;
  return {
    mintage: Number.isFinite(n) && n > 0 ? n : null,
    mintage_display: raw,
  };
}

function parseFaceValue(title) {
  const m = String(title || "").match(/\$\s*(\d+(?:\.\d+)?)/);
  if (!m) return null;
  return `$${m[1]}`;
}

function parseDims(specs) {
  const s = String(specs.Dimensions || "").replace(/,/g, ".").trim();
  if (!s) return { diameter_mm: null, length_mm: null, width_mm: null, thickness_mm: null };
  const xyz = s.match(/(\d+(?:\.\d+)?)\s*[x×]\s*(\d+(?:\.\d+)?)\s*[x×]\s*(\d+(?:\.\d+)?)/i);
  if (xyz) {
    return { length_mm: xyz[0] ? xyz[1] : null, width_mm: xyz[2], thickness_mm: xyz[3], diameter_mm: null };
  }
  const xy = s.match(/(\d+(?:\.\d+)?)\s*[x×]\s*(\d+(?:\.\d+)?)/i);
  if (xy) return { length_mm: xy[1], width_mm: xy[2], thickness_mm: null, diameter_mm: null };
  const d = parseNumber(s);
  return { diameter_mm: d == null ? null : d, length_mm: null, width_mm: null, thickness_mm: null };
}

function safeTitle(raw, source) {
  const t = String(raw || "").replace(/\s+/g, " ").trim();
  return t || source;
}

async function main() {
  const files = fs
    .readdirSync(DATA_DIR)
    .filter((f) => f.startsWith("scottsdale-mint-") && f.endsWith(".json") && !f.includes("listing-products"))
    .map((f) => path.join(DATA_DIR, f))
    .sort();
  if (!files.length) throw new Error("Нет data/scottsdale-mint-*.json");

  const conn = await mysql.createConnection(getConfig());

  const report = {
    total: files.length,
    inserted: 0,
    updated: 0,
    skipped_random: 0,
    skipped_duplicate: 0,
    errors: 0,
  };

  const cols = [
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
    "image_urls",
    "source_url",
  ];

  for (let i = 0; i < files.length; i++) {
    const fp = files[i];
    process.stdout.write(`\r[${i + 1}/${files.length}] ${path.basename(fp)}   `);
    try {
      const raw = JSON.parse(fs.readFileSync(fp, "utf8"));
      const c = raw.coin || {};
      const source = normalizeUrl(c.source_url);
      if (!source) continue;
      if (isInvalidSourceUrl(source)) {
        report.skipped_random++;
        continue;
      }

      const title = safeTitle(c.title, source);
      if (isRandomTitle(title)) {
        report.skipped_random++;
        continue;
      }
      const specs = c.specs || {};
      const yearDate = parseYearToDate(title);
      const metal = parseMetal(specs, title);
      const fineness = parseFineness(specs);
      const { mintage, mintage_display } = parseMintage(specs);
      const { weight_g, weight_oz } = parseWeight(specs);
      const face = parseFaceValue(title);
      const dims = parseDims(specs);
      const grade = String(specs.Grade || "").trim() || null;
      const manufacturer = String(specs.Manufacturer || "").trim();
      const mint = manufacturer || "Scottsdale Mint";

      const [exists] = await conn.execute("SELECT id FROM coins WHERE source_url = ? LIMIT 1", [source]);

      // Только для INSERT: иначе находим ту же строку по title_en+год+металл+вес и пропускаем UPDATE (сломанные image_urls).
      if (!exists.length && title && yearDate && metal && weight_g != null) {
        const [dup] = await conn.execute(
          `SELECT id FROM coins
           WHERE title_en = ? AND release_date = ? AND metal = ? AND ABS(CAST(weight_g AS DECIMAL(10,3)) - ?) <= 0.03
           LIMIT 1`,
          [title, yearDate, metal, weight_g]
        );
        if (dup.length) {
          report.skipped_duplicate++;
          continue;
        }
      }

      /** В каталоге и на сайте не больше 7 кадров; полная съёмка с Scottsdale давала 50+ дублей. */
      const imageUrls = (Array.isArray(c.imageUrls) ? c.imageUrls.filter(Boolean) : []).slice(0, 7);
      const row = {
        title,
        title_en: title,
        series: "Scottsdale Mint",
        country: "США",
        face_value: face,
        mint,
        mint_short: "Scottsdale Mint",
        metal,
        metal_fineness: fineness,
        mintage,
        mintage_display,
        weight_g,
        weight_oz,
        release_date: yearDate,
        catalog_number: null,
        catalog_suffix: String(c.slug || "").slice(0, 32) || null,
        quality: grade,
        diameter_mm: dims.diameter_mm,
        thickness_mm: dims.thickness_mm,
        length_mm: dims.length_mm,
        width_mm: dims.width_mm,
        image_obverse: c.image_obverse || imageUrls[0] || null,
        image_reverse: c.image_reverse || imageUrls[1] || imageUrls[0] || null,
        image_urls: imageUrls.length ? JSON.stringify(imageUrls) : null,
        source_url: source,
      };

      if (exists.length) {
        const setClause = cols.map((x) => `${x} = ?`).join(", ");
        const vals = cols.map((x) => row[x]);
        await conn.execute(`UPDATE coins SET ${setClause} WHERE source_url = ?`, [...vals, source]);
        report.updated++;
      } else {
        const qs = cols.map(() => "?").join(", ");
        const vals = cols.map((x) => row[x]);
        await conn.execute(`INSERT INTO coins (${cols.join(", ")}) VALUES (${qs})`, vals);
        report.inserted++;
      }
    } catch (e) {
      console.error(`\nIMPORT_FAIL ${path.basename(fp)}:`, e && e.message ? e.message : e);
      report.errors++;
    }
  }
  await conn.end();

  const reportFile = path.join(__dirname, "..", "reports", "scottsdale-import-report.json");
  fs.writeFileSync(reportFile, JSON.stringify(report, null, 2), "utf8");
  console.log("\nГотово.");
  console.log(report);
  console.log("Отчет:", reportFile);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

