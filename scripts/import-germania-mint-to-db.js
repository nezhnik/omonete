/**
 * Импорт продуктов Germania Mint (coins + bars) из data/germania-mint-*.json в таблицу coins.
 * Ключ обновления: source_url (канонический URL карточки товара).
 *
 * Запуск:
 *   node scripts/import-germania-mint-to-db.js
 *   node scripts/import-germania-mint-to-db.js data/germania-mint-foo.json
 *   node scripts/import-germania-mint-to-db.js data/germania-mint-bar-foo.json
 */
require("dotenv").config({ path: ".env" });
const mysql = require("mysql2/promise");
const fs = require("fs");
const path = require("path");
const sharp = require("sharp");
const { sanitizeGermaniaMintTitle } = require("./germania-mint-title-sanitize.js");
const { finenessNumericOnly } = require("./format-coin-characteristics.js");
const { finalizeMintageForDb, logImportMintageSummary } = require("./parsing-mintage-constants.js");

const DATA_DIR = path.join(__dirname, "..", "data");
const FOREIGN_IMG_DIR = path.join(__dirname, "..", "public", "image", "coins", "foreign");

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

function normalizeUrl(url) {
  if (!url || typeof url !== "string") return null;
  try {
    const u = new URL(url.trim());
    u.hash = "";
    u.search = "";
    return u.toString().replace(/\/+$/, "");
  } catch {
    return String(url).trim().replace(/\/+$/, "") || null;
  }
}

function slugFromUrl(url) {
  try {
    const u = new URL(url);
    const parts = u.pathname.split("/").filter(Boolean);
    return parts[parts.length - 1] || "coin";
  } catch {
    return "coin";
  }
}

function parseYearToDate(yearStr) {
  const s = String(yearStr || "").trim();
  if (/^(19|20)\d{2}$/.test(s)) return `${s}-01-01`;
  return null;
}

function parseDiameterMm(diameterStr) {
  const s = String(diameterStr || "").replace(",", ".").trim();
  const m = s.match(/(\d+(?:\.\d+)?)/);
  return m ? m[1] : null;
}

function normalizeQuality(grade) {
  const s = String(grade || "").trim();
  if (!s) return null;
  if (/^bu$/i.test(s)) return "BU";
  if (/prooflike/i.test(s)) return "Prooflike";
  if (/^proof$/i.test(s)) return "Proof";
  if (/uhr|ultra high relief/i.test(s)) return "UHR";
  if (/high relief/i.test(s)) return "High Relief";
  return s;
}

function metalFromPurity(purity) {
  const s = String(purity || "").toUpperCase();
  if (s.includes("AG")) return "Серебро";
  if (s.includes("AU")) return "Золото";
  if (s.includes("CU")) return "Медь";
  return null;
}

function countryFromData(sourceUrl, title) {
  const u = String(sourceUrl || "").toLowerCase();
  const t = String(title || "");
  if (u.includes("/malta/") || /malta/i.test(t)) return "Мальта";
  if (/niue/i.test(t)) return "Ниуэ";
  if (/liberia/i.test(t)) return "Либерия";
  return "Польша";
}

function parseMintage(mintageStr) {
  const raw = String(mintageStr || "").trim();
  if (!raw) return { mintage: null, mintageDisplay: null };
  const digits = raw.replace(/[^\d]/g, "");
  const n = digits ? Number(digits) : null;
  return {
    mintage: Number.isFinite(n) && n > 0 ? n : null,
    mintageDisplay: raw,
  };
}

function parseNumberLike(raw) {
  if (raw == null) return null;
  const s = String(raw).replace(",", ".").trim();
  const m = s.match(/(\d+(?:\.\d+)?)/);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : null;
}

function parseFractionLike(raw) {
  if (raw == null) return null;
  const s = String(raw).replace(",", ".").trim();
  const m = s.match(/(\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)/);
  if (!m) return null;
  const a = Number(m[1]);
  const b = Number(m[2]);
  if (!Number.isFinite(a) || !Number.isFinite(b) || b === 0) return null;
  return a / b;
}

function roundTo(value, digits) {
  const p = 10 ** digits;
  return Math.round(value * p) / p;
}

function formatOz(ozValue) {
  if (!Number.isFinite(ozValue) || ozValue <= 0) return null;
  return `${roundTo(ozValue, 4)} oz`;
}

/**
 * Вес из спецификации и названия. Нельзя брать «первое число» из всей строки с годом:
 * «2023 Germania Kilo…» давало n=2023 и ветку kilo → 2 023 000 г;
 * «2023 … 1 oz» давало n=2023 и ветку oz → ~62 922 г.
 */
function deriveWeight(weightRaw, titleRaw) {
  const specs = String(weightRaw || "").trim();
  const title = String(titleRaw || "")
    .replace(/^(19|20)\d{2}\s+/i, "")
    .trim();
  const combined = `${specs} ${title}`.trim();
  if (!combined) return { weightG: null, weightOz: null };

  const lower = combined.toLowerCase();

  const ozMatches = [...lower.matchAll(/\b(\d+(?:\.\d+)?)\s*oz\b/g)];
  if (ozMatches.length) {
    const n = Number(ozMatches[ozMatches.length - 1][1]);
    if (Number.isFinite(n) && n > 0) {
      const weightG = roundTo(n * 31.1034768, 2);
      return { weightG, weightOz: formatOz(n) };
    }
  }

  const kgMatch = lower.match(/\b(\d+(?:\.\d+)?)\s*(kg|kilo)\b/);
  if (kgMatch) {
    const n = Number(kgMatch[1]);
    if (Number.isFinite(n) && n > 0) {
      const weightG = roundTo(n * 1000, 2);
      const weightOz = formatOz(n * 32.1507466);
      return { weightG, weightOz };
    }
  }

  if (/\bkilo\b/i.test(lower)) {
    const weightG = roundTo(1000, 2);
    const weightOz = formatOz(32.1507466);
    return { weightG, weightOz };
  }

  const n = parseFractionLike(specs) ?? parseNumberLike(specs);
  if (!Number.isFinite(n) || n <= 0) return { weightG: null, weightOz: null };
  const lowSpecs = specs.toLowerCase();
  if (/\boz\b|ounce|ounces|унц/i.test(lowSpecs)) {
    const weightG = roundTo(n * 31.1034768, 2);
    return { weightG, weightOz: formatOz(n) };
  }
  if (/\bkg\b|kilo|кил/i.test(lowSpecs)) {
    const weightG = roundTo(n * 1000, 2);
    return { weightG, weightOz: formatOz(n * 32.1507466) };
  }
  if (/\bg\b|gram|grams|гр|грам/i.test(lowSpecs)) {
    const weightG = roundTo(n, 2);
    return { weightG, weightOz: formatOz(n / 31.1034768) };
  }
  return { weightG: null, weightOz: null };
}

function ensureDir(p) {
  if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
}

function sanitizeFilePart(v) {
  return String(v || "")
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 120);
}

async function fetchBuffer(url, timeoutMs = 30000) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      redirect: "follow",
      signal: ac.signal,
      headers: { "user-agent": "Mozilla/5.0 (compatible; omonete-bot/1.0)" },
    });
    if (!res.ok) return null;
    return Buffer.from(await res.arrayBuffer());
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

async function localizeForeignImage(url, fileBase) {
  if (!url || typeof url !== "string") return null;
  const raw = String(url).trim();
  if (!raw) return null;
  if (raw.startsWith("/image/coins/foreign/")) return raw;
  if (!/^https?:\/\//i.test(raw)) return null;

  ensureDir(FOREIGN_IMG_DIR);
  const safe = sanitizeFilePart(fileBase) || `germania-${Date.now()}`;
  const fileName = `${safe}.webp`;
  const absOut = path.join(FOREIGN_IMG_DIR, fileName);
  const relOut = `/image/coins/foreign/${fileName}`;

  if (fs.existsSync(absOut) && fs.statSync(absOut).size > 0) return relOut;

  const buf = await fetchBuffer(raw);
  if (!buf || buf.length === 0) return null;
  try {
    await sharp(buf).webp({ quality: 90 }).toFile(absOut);
    return relOut;
  } catch {
    return null;
  }
}

async function main() {
  const arg = process.argv[2];
  let files = [];

  if (arg && arg.endsWith(".json")) {
    const p = path.isAbsolute(arg) ? arg : path.join(process.cwd(), arg);
    if (!fs.existsSync(p)) {
      console.error("Файл не найден:", p);
      process.exit(1);
    }
    files = [p];
  } else {
    files = fs
      .readdirSync(DATA_DIR)
      .filter(
        (f) =>
          f.startsWith("germania-mint-") &&
          f.endsWith(".json") &&
          !f.includes("listing-products") &&
          !f.includes("bars-listing-products")
      )
      .map((f) => path.join(DATA_DIR, f))
      .sort();
  }

  if (!files.length) {
    console.error("Нет файлов germania-mint-*.json в data/");
    process.exit(1);
  }

  const conn = await mysql.createConnection(getConfig());

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
    "image_obverse",
    "image_reverse",
    "image_box",
    "image_certificate",
    "source_url",
  ];

  const updateCols = cols.filter((k) => k !== "catalog_number");
  const setClause = updateCols.map((k) => `${k} = ?`).join(", ");

  let inserted = 0;
  let updated = 0;
  const mintageStats = [];

  for (const filePath of files) {
    let raw;
    try {
      raw = JSON.parse(fs.readFileSync(filePath, "utf8"));
    } catch {
      continue;
    }
    const sourceUrl = normalizeUrl(raw.source_url);
    if (!sourceUrl || !/germaniamint\.com/i.test(sourceUrl)) continue;

    const slug = slugFromUrl(sourceUrl);
    const specs = raw.specs || {};
    const title = sanitizeGermaniaMintTitle(String(raw.title || "").trim());
    const country = countryFromData(sourceUrl, title);
    let { mintage, mintageDisplay } = parseMintage(specs.Mintage);
    ({ mintage, mintageDisplay } = finalizeMintageForDb(mintage, mintageDisplay, country));
    const faceValue = specs.Denomination ? String(specs.Denomination).trim() : null;
    const quality = normalizeQuality(specs.Grade);
    const purityStr = specs.Purity ? String(specs.Purity).trim() : "";
    const metal = metalFromPurity(purityStr);
    const metalFineness = finenessNumericOnly(purityStr) || null;
    const diameterMm = parseDiameterMm(specs.Diameter);
    const releaseDate = parseYearToDate(specs.Year);
    const series = specs.Series ? String(specs.Series).trim() : null;
    const imageObverseSrc = raw.classified?.obverse || null;
    const imageReverseSrc = raw.classified?.reverse || null;
    const imageObverse = await localizeForeignImage(imageObverseSrc, `${slug}-obv`);
    const imageReverse = await localizeForeignImage(imageReverseSrc, `${slug}-rev`);
    const { weightG, weightOz } = deriveWeight(specs.Weight, title);
    const catalogNumber = `PL-GERMANIA-${slug}`.toUpperCase().slice(0, 64);

    const values = [
      title || slug,
      title || null,
      series,
      country,
      faceValue,
      "Germania Mint",
      "Germania Mint",
      metal,
      metalFineness,
      mintage,
      mintageDisplay,
      weightG,
      weightOz,
      releaseDate,
      catalogNumber,
      slug,
      quality,
      diameterMm,
      imageObverse,
      imageReverse,
      null,
      null,
      sourceUrl,
    ];

    const [rows] = await conn.execute(
      "SELECT id FROM coins WHERE source_url = ? LIMIT 1",
      [sourceUrl]
    );

    if (rows.length > 0) {
      const catalogIdx = cols.indexOf("catalog_number");
      const updateValues = [...values.slice(0, catalogIdx), ...values.slice(catalogIdx + 1), rows[0].id];
      await conn.execute(`UPDATE coins SET ${setClause} WHERE id = ?`, updateValues);
      updated++;
    } else {
      const placeholders = cols.map(() => "?").join(", ");
      await conn.execute(`INSERT INTO coins (${cols.join(", ")}) VALUES (${placeholders})`, values);
      inserted++;
    }
    mintageStats.push({ mintage, mintage_display: mintageDisplay });
  }

  await conn.end();
  logImportMintageSummary("Germania Mint", mintageStats);
  console.log(`✓ Germania Mint: добавлено ${inserted}, обновлено ${updated}`);
  console.log("Дальше: npm run data:export");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
