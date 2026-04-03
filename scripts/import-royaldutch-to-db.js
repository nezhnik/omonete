/**
 * Импорт Royal Dutch Mint из data/royaldutch-mint-*.json.
 * Защита от дублей по source_url.
 */
require("dotenv").config({ path: ".env" });
const fs = require("fs");
const path = require("path");
const mysql = require("mysql2/promise");

const DATA_DIR = path.join(__dirname, "..", "data");
const REPORT_DIR = path.join(__dirname, "..", "reports");

function getConfig() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL не задан");
  const m = url.match(/mysql:\/\/([^:]+):([^@]+)@([^:]+):(\d+)\/(.+)/);
  if (!m) throw new Error("Неверный формат DATABASE_URL");
  const [, user, password, host, port, database] = m;
  return { host, port: Number(port), user, password, database };
}

function parseNumber(s) {
  if (s == null) return null;
  const m = String(s).replace(",", ".").match(/(\d+(?:\.\d+)?)/);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : null;
}

function parseYearToDate(title) {
  const m = String(title || "").match(/\b(19|20)\d{2}\b/);
  return m ? `${m[0]}-01-01` : null;
}

function parseWeight(specs) {
  const raw =
    String(specs.Weight || specs["Fine weight"] || specs.Gewicht || specs["Net weight"] || "").trim();
  if (!raw) return { weight_g: null, weight_oz: null };
  const n = parseNumber(raw);
  if (n == null) return { weight_g: null, weight_oz: null };
  if (/oz|ounce|troy/i.test(raw)) return { weight_g: Math.round(n * 31.1034768 * 100) / 100, weight_oz: n };
  if (/kg|kilo/i.test(raw)) {
    const g = Math.round(n * 1000 * 100) / 100;
    return { weight_g: g, weight_oz: Math.round((g / 31.1034768) * 10000) / 10000 };
  }
  const g = Math.round(n * 100) / 100;
  return { weight_g: g, weight_oz: Math.round((g / 31.1034768) * 10000) / 10000 };
}

function parseMetal(specs, title) {
  const src = `${Object.values(specs || {}).join(" ")} ${title || ""}`.toLowerCase();
  if (/silver|zilver|ag\b/.test(src)) return "Серебро";
  if (/gold|goud|au\b/.test(src)) return "Золото";
  if (/copper|koper|cu\b/.test(src)) return "Медь";
  if (/platinum|platina|pt\b/.test(src)) return "Платина";
  return null;
}

function parseMintage(specs) {
  const raw = String(specs.Mintage || specs["Maximum mintage"] || specs.Oplage || "").trim();
  if (!raw) return { mintage: null, mintage_display: null };
  if (/∞|unlimited|onbeperkt/i.test(raw)) return { mintage: null, mintage_display: "Не ограничен" };
  const digits = raw.replace(/[^\d]/g, "");
  const n = digits ? Number(digits) : null;
  return { mintage: Number.isFinite(n) && n > 0 ? n : null, mintage_display: raw };
}

function parseFaceValue(specs, title) {
  const raw = String(specs.Denomination || specs["Face value"] || specs.Nominal || "").trim();
  if (raw) return raw;
  const m = String(title || "").match(/\b(\d+(?:[.,]\d+)?)\s*(euro|€)\b/i);
  if (!m) return null;
  return `${m[1].replace(",", ".")} euro`;
}

function parseFineness(specs) {
  const raw = String(specs.Fineness || specs.Purity || specs.Fijnheid || "").trim();
  if (!raw) return null;
  const m = raw.match(/(\d{2,4}(?:\.\d+)?)/);
  if (!m) return null;
  const n = Number(m[1]);
  if (!Number.isFinite(n)) return null;
  if (n <= 1) return null;
  if (n < 10) return String(Math.round(n * 1000));
  if (n <= 100) return String(Math.round(n * 10));
  return String(Math.round(n));
}

function isGradedTitle(title) {
  const s = String(title || "").toLowerCase();
  return /\bngc\b/.test(s) || /\b(ms|pf)\s*-?\d{2}\b/.test(s) || /\b(ms|pf)\d{2}\b/.test(s);
}

async function main() {
  const files = fs
    .readdirSync(DATA_DIR)
    .filter((f) => f.startsWith("royaldutch-mint-") && f.endsWith(".json") && !f.includes("listing-products"))
    .map((f) => path.join(DATA_DIR, f))
    .sort();
  if (!files.length) throw new Error("Нет data/royaldutch-mint-*.json");
  if (!fs.existsSync(REPORT_DIR)) fs.mkdirSync(REPORT_DIR, { recursive: true });

  const conn = await mysql.createConnection(getConfig());
  const report = { total: files.length, inserted: 0, updated: 0, skipped_duplicate: 0, skipped_graded: 0, errors: 0 };

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
    "image_packaging",
    "image_box",
    "image_urls",
    "source_url",
  ];

  for (let i = 0; i < files.length; i++) {
    const fp = files[i];
    process.stdout.write(`\r[${i + 1}/${files.length}] ${path.basename(fp)}   `);
    try {
      const raw = JSON.parse(fs.readFileSync(fp, "utf8"));
      const c = raw.coin || {};
      const title = String(c.title || "").trim();
      const specs = c.specs || {};
      const source = String(c.source_url || "").trim();
      if (!source) continue;
      if (isGradedTitle(title)) {
        report.skipped_graded++;
        continue;
      }

      const { weight_g, weight_oz } = parseWeight(specs);
      const { mintage, mintage_display } = parseMintage(specs);
      const releaseDate = parseYearToDate(title);
      const metal = parseMetal(specs, title);

      if (title && releaseDate && metal && weight_g != null) {
        const [dup] = await conn.execute(
          `SELECT id FROM coins
           WHERE title_en = ? AND release_date = ? AND metal = ? AND ABS(CAST(weight_g AS DECIMAL(10,3)) - ?) <= 0.03
           LIMIT 1`,
          [title, releaseDate, metal, weight_g]
        );
        if (dup.length) {
          report.skipped_duplicate++;
          continue;
        }
      }

      const row = {
        title: title || source,
        title_en: title || source,
        series: "Royal Dutch Mint",
        country: "Нидерланды",
        face_value: parseFaceValue(specs, title),
        mint: "Royal Dutch Mint",
        mint_short: "Royal Dutch Mint",
        metal,
        metal_fineness: parseFineness(specs),
        mintage,
        mintage_display,
        weight_g,
        weight_oz,
        release_date: releaseDate,
        catalog_number: null,
        catalog_suffix: String(c.slug || "").slice(0, 32) || null,
        quality: String(specs.Quality || specs.Kwaliteit || "").trim() || null,
        diameter_mm: parseNumber(specs.Diameter || specs.Diameter_mm || null),
        thickness_mm: parseNumber(specs.Thickness || specs.Dikte || null),
        length_mm: null,
        width_mm: null,
        image_obverse: c.image_obverse || null,
        image_reverse: c.image_reverse || c.image_obverse || null,
        image_packaging: c.image_packaging || null,
        image_box: c.image_box || null,
        image_urls: Array.isArray(c.imageUrls) ? JSON.stringify(c.imageUrls.filter(Boolean)) : null,
        source_url: source,
      };

      const [exists] = await conn.execute("SELECT id FROM coins WHERE source_url = ? LIMIT 1", [source]);
      if (exists.length) {
        const setClause = cols.map((x) => `${x} = ?`).join(", ");
        await conn.execute(`UPDATE coins SET ${setClause} WHERE source_url = ?`, [
          ...cols.map((x) => row[x]),
          source,
        ]);
        report.updated++;
      } else {
        const qs = cols.map(() => "?").join(", ");
        await conn.execute(`INSERT INTO coins (${cols.join(", ")}) VALUES (${qs})`, cols.map((x) => row[x]));
        report.inserted++;
      }
    } catch {
      report.errors++;
    }
  }

  await conn.end();
  const reportFile = path.join(REPORT_DIR, "royaldutch-import-report.json");
  fs.writeFileSync(reportFile, JSON.stringify(report, null, 2), "utf8");
  console.log("\nГотово.");
  console.log(report);
  console.log("Отчет:", reportFile);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

