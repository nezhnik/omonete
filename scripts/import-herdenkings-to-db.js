/**
 * Импорт Herdenkings из data/herdenkings-*.json.
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
  const raw = String(specs.Poids || specs.Weight || specs["Poids fin"] || specs["Fine weight"] || "").trim();
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
  if (/argent|silver|ag\b/.test(src)) return "Серебро";
  if (/or|gold|au\b/.test(src)) return "Золото";
  if (/cuivre|copper|cu\b/.test(src)) return "Медь";
  if (/platine|platinum|pt\b/.test(src)) return "Платина";
  return null;
}

function parseMintage(specs) {
  const raw = String(specs.Tirage || specs.Mintage || "").trim();
  if (!raw) return { mintage: null, mintage_display: null };
  if (/∞|illimit|unlimited/i.test(raw)) return { mintage: null, mintage_display: "Не ограничен" };
  const digits = raw.replace(/[^\d]/g, "");
  const n = digits ? Number(digits) : null;
  return { mintage: Number.isFinite(n) && n > 0 ? n : null, mintage_display: raw };
}

function parseFaceValue(specs, title) {
  const raw = String(specs["Valeur faciale"] || specs.Denomination || specs["Face value"] || "").trim();
  if (raw) return raw;
  const m = String(title || "").match(/\b(\d+(?:[.,]\d+)?)\s*(euro|€|franc)\b/i);
  if (!m) return null;
  return `${m[1].replace(",", ".")} ${m[2]}`;
}

function parseFineness(specs) {
  const raw = String(specs.Finesse || specs.Pureté || specs.Fineness || specs.Purity || "").trim();
  if (!raw) return null;
  const m = raw.match(/(\d{2,4}(?:\.\d+)?)/);
  if (!m) return null;
  const n = Number(m[1]);
  if (!Number.isFinite(n) || n <= 1) return null;
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
    .filter((f) => f.startsWith("herdenkings-") && f.endsWith(".json") && !f.includes("listing-products"))
    .map((f) => path.join(DATA_DIR, f))
    .sort();
  if (!files.length) throw new Error("Нет data/herdenkings-*.json");
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
        series: "Herdenkingsmunten",
        country: "Бельгия",
        face_value: parseFaceValue(specs, title),
        mint: "Herdenkingsmunten",
        mint_short: "Herdenkingsmunten",
        metal,
        metal_fineness: parseFineness(specs),
        mintage,
        mintage_display,
        weight_g,
        weight_oz,
        release_date: releaseDate,
        catalog_number: null,
        catalog_suffix: String(c.slug || "").slice(0, 32) || null,
        quality: String(specs.Qualité || specs.Quality || "").trim() || null,
        diameter_mm: parseNumber(specs.Diamètre || specs.Diameter || null),
        thickness_mm: parseNumber(specs.Épaisseur || specs.Thickness || null),
        length_mm: null,
        width_mm: null,
        image_obverse: c.image_obverse || null,
        image_reverse: c.image_reverse || c.image_obverse || null,
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
  const reportFile = path.join(REPORT_DIR, "herdenkings-import-report.json");
  fs.writeFileSync(reportFile, JSON.stringify(report, null, 2), "utf8");
  console.log("\nГотово.");
  console.log(report);
  console.log("Отчет:", reportFile);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

