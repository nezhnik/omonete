/**
 * Импорт PAMP в coins (ключ обновления: source_url).
 * Картинки: только пути /image/coins/foreign/... из JSON (файлы должны быть после fetch-pamp-product).
 * Сеть и браузер на импорте не используются.
 *
 * - По умолчанию: data/pamp-collectible-*.json (без listing-products), серия «PAMP Collectibles».
 * - --minted-bars: только data/pamp-minted-bar-*.json, серия «PAMP Minted Bars».
 * - --cast-bars: только data/pamp-cast-bar-*.json, серия «PAMP Cast Bars».
 */
require("dotenv").config({ path: ".env" });
const mysql = require("mysql2/promise");
const fs = require("fs");
const path = require("path");
const { finalizeMintageForDb, logImportMintageSummary } = require("./parsing-mintage-constants.js");

const DATA_DIR = path.join(__dirname, "..", "data");
const PUBLIC_ROOT = path.join(__dirname, "..", "public");
const { derivePampWeight } = require("../lib/pampWeightDerive");
const { finenessNumericOnly } = require("./format-coin-characteristics.js");

function getConfig() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL не задан");
  const m = url.match(/mysql:\/\/([^:]+):([^@]+)@([^:]+):(\d+)\/(.+)/);
  if (!m) throw new Error("Неверный формат DATABASE_URL");
  const [, user, password, host, port, database] = m;
  return { host, port: Number(port), user, password, database };
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
    return parts[parts.length - 1] || "pamp-item";
  } catch {
    return "pamp-item";
  }
}

function parseYearToDate(specs, title) {
  const src = `${specs.Year || ""} ${title || ""}`;
  const m = String(src).match(/\b(19|20)\d{2}\b/);
  return m ? `${m[0]}-01-01` : null;
}

function parseNumberLike(raw) {
  if (raw == null) return null;
  const s = String(raw).replace(",", ".").trim();
  const m = s.match(/(\d+(?:\.\d+)?)/);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : null;
}

function parseMintage(specs, title) {
  const specM = specs.Mintage != null ? String(specs.Mintage).trim() : "";
  if (specM) {
    const digits = specM.replace(/[^\d]/g, "");
    const n = digits ? Number(digits) : null;
    return { mintage: Number.isFinite(n) && n > 0 ? n : null, mintageDisplay: specM || null };
  }
  const t = String(title || "").trim();
  const fromDesc = t.match(/\blimited mintage of\s*([\d,.\s]+)\b/i);
  if (fromDesc) {
    const display = fromDesc[1].replace(/\s+/g, " ").trim();
    const digits = display.replace(/[^\d]/g, "");
    const n = digits ? Number(digits) : null;
    return { mintage: Number.isFinite(n) && n > 0 ? n : null, mintageDisplay: display || null };
  }
  const fromCoinsTitle = t.match(/\bmintage of (?:only\s+)?([\d,.\s]+)\s*coins?\b/i);
  if (fromCoinsTitle) {
    const display = fromCoinsTitle[1].replace(/\s+/g, " ").trim();
    const digits = display.replace(/[^\d]/g, "");
    const n = digits ? Number(digits) : null;
    return { mintage: Number.isFinite(n) && n > 0 ? n : null, mintageDisplay: display || null };
  }
  return { mintage: null, mintageDisplay: null };
}

function parsePurity(specs) {
  return specs.Purity ? String(specs.Purity).trim() : null;
}

/** Проба: дробь 925/1000 или число 999.9 — см. finenessNumericOnly */
function normalizePampFineness(raw) {
  return finenessNumericOnly(raw == null ? "" : String(raw));
}

function parseMetal(purity, title, specs) {
  const metalLine = specs && specs.Metal != null ? String(specs.Metal).trim() : "";
  if (metalLine) {
    const ml = metalLine.toLowerCase();
    if (/\bgold\b|золот/i.test(ml)) return "Золото";
    if (/\bsilver\b|сереб/i.test(ml)) return "Серебро";
    if (/\bplatinum\b|платин/i.test(ml)) return "Платина";
    if (/\bpalladium\b|паллад/i.test(ml)) return "Палладий";
    if (/\bcopper\b|мед/i.test(ml)) return "Медь";
  }
  const p = String(purity || "").toUpperCase();
  const t = String(title || "").toLowerCase();
  if (p.includes("AU") || /\bgold\b|золот/i.test(t)) return "Золото";
  if (p.includes("AG") || /\bsilver\b|сереб/i.test(t)) return "Серебро";
  if (p.includes("CU") || /\bcopper\b|мед/i.test(t)) return "Медь";
  return null;
}

function seriesForPampRow(sourceUrl, specs, importKind) {
  if (specs.Series && String(specs.Series).trim()) return String(specs.Series).trim();
  if (importKind === "minted-bars") return "PAMP Minted Bars";
  if (importKind === "cast-bars") return "PAMP Cast Bars";
  if (/\/product\/minted-ingots\//i.test(String(sourceUrl || ""))) return "PAMP Minted Bars";
  if (/\/product\/cast-bars\//i.test(String(sourceUrl || "")) || /\/product\/cast\//i.test(String(sourceUrl || "")))
    return "PAMP Cast Bars";
  return "PAMP Collectibles";
}

function parseDimensions(specs) {
  const raw = String(
    specs["Size (mm)."] || specs["Size (mm)"] || specs.Size || specs.Dimensions || ""
  )
    .replace(",", ".")
    .trim();
  if (!raw) return { lengthMm: null, widthMm: null, diameterMm: null, thicknessMm: null };
  const size = raw.match(/(\d+(?:\.\d+)?)\s*[x×]\s*(\d+(?:\.\d+)?)/i);
  if (size) {
    return { lengthMm: size[1], widthMm: size[2], diameterMm: null, thicknessMm: parseNumberLike(specs.Thickness || "") };
  }
  return { lengthMm: null, widthMm: null, diameterMm: parseNumberLike(raw), thicknessMm: parseNumberLike(specs.Thickness || "") };
}

/** Поля из JSON после fetch-pamp-product (путь + файл на диске). */
function imagePathFromPampJson(val) {
  if (!val || typeof val !== "string") return null;
  const s = val.trim();
  if (!s.startsWith("/image/coins/foreign/")) return null;
  const abs = path.join(PUBLIC_ROOT, s.replace(/^\//, ""));
  try {
    if (fs.existsSync(abs) && fs.statSync(abs).size > 0) return s;
  } catch {
    return null;
  }
  return null;
}

async function main() {
  const mintedBarsOnly = process.argv.includes("--minted-bars");
  const castBarsOnly = process.argv.includes("--cast-bars");
  const importKind = mintedBarsOnly ? "minted-bars" : castBarsOnly ? "cast-bars" : null;
  const arg = process.argv.find((a) => a.endsWith(".json") && !a.startsWith("--"));
  let files = [];
  if (arg && arg.endsWith(".json")) {
    const p = path.isAbsolute(arg) ? arg : path.join(process.cwd(), arg);
    if (!fs.existsSync(p)) throw new Error(`Файл не найден: ${p}`);
    files = [p];
  } else if (mintedBarsOnly) {
    files = fs
      .readdirSync(DATA_DIR)
      .filter((f) => f.startsWith("pamp-minted-bar-") && f.endsWith(".json"))
      .map((f) => path.join(DATA_DIR, f))
      .sort();
  } else if (castBarsOnly) {
    files = fs
      .readdirSync(DATA_DIR)
      .filter((f) => f.startsWith("pamp-cast-bar-") && f.endsWith(".json"))
      .map((f) => path.join(DATA_DIR, f))
      .sort();
  } else {
    files = fs
      .readdirSync(DATA_DIR)
      .filter((f) => f.startsWith("pamp-collectible-") && f.endsWith(".json") && !f.includes("listing-products"))
      .map((f) => path.join(DATA_DIR, f))
      .sort();
  }
  if (!files.length) {
    throw new Error(
      mintedBarsOnly
        ? "Нет pamp-minted-bar-*.json — сначала npm run pamp:fetch:minted-bars:all"
        : castBarsOnly
          ? "Нет pamp-cast-bar-*.json — сначала npm run pamp:fetch:cast-bars:all"
          : "Нет файлов pamp-collectible-*.json"
    );
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
    "thickness_mm",
    "length_mm",
    "width_mm",
    "image_obverse",
    "image_reverse",
    "image_blister_obverse",
    "image_blister_reverse",
    "image_packaging",
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
    if (!sourceUrl || !/pamp\.com/i.test(sourceUrl)) continue;
    const slug = slugFromUrl(sourceUrl);
    const specs = raw.specs || {};
    const title = String(raw.title || "").trim() || slug;
    const purityRaw = parsePurity(specs);
    const metalFineness =
      normalizePampFineness(purityRaw) ||
      normalizePampFineness(specs.Metal != null ? String(specs.Metal) : "") ||
      null;
    const metal = parseMetal(purityRaw, title, specs);
    let { mintage, mintageDisplay } = parseMintage(specs, title);
    ({ mintage, mintageDisplay } = finalizeMintageForDb(mintage, mintageDisplay, "Швейцария"));
    const { weightG, weightOz } = derivePampWeight(specs, title);
    const releaseDate = parseYearToDate(specs, title);
    const faceValue = specs.Denomination ? String(specs.Denomination).trim() : "—";
    const series = seriesForPampRow(sourceUrl, specs, importKind);
    const quality = specs.Grade ? String(specs.Grade).trim() : null;
    const { lengthMm, widthMm, diameterMm, thicknessMm } = parseDimensions(specs);
    const classified = raw.classified || {};

    const imageObverse = imagePathFromPampJson(classified.obverse);
    const imageReverse = imagePathFromPampJson(classified.reverse);
    const imageBlisterObv = imagePathFromPampJson(classified.blister_obverse);
    const imageBlisterRev = imagePathFromPampJson(classified.blister_reverse);
    const imagePackaging = (imageBlisterObv && imageBlisterRev)
      ? null
      : imagePathFromPampJson(classified.packaging);
    const imageBox = imagePathFromPampJson(classified.box);
    const imageCertificate = imagePathFromPampJson(classified.certificate);

    const catalogNumber = `CH-PAMP-${slug}`.toUpperCase().slice(0, 64);
    const values = [
      title,
      title,
      series,
      "Швейцария",
      faceValue,
      "PAMP",
      "PAMP",
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
      thicknessMm,
      lengthMm,
      widthMm,
      imageObverse,
      imageReverse,
      imageBlisterObv,
      imageBlisterRev,
      imagePackaging,
      imageBox,
      imageCertificate,
      sourceUrl,
    ];

    const [rows] = await conn.execute("SELECT id FROM coins WHERE source_url = ? LIMIT 1", [sourceUrl]);
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
  logImportMintageSummary("PAMP", mintageStats);
  const suffix = mintedBarsOnly ? " (minted bars)" : castBarsOnly ? " (cast bars)" : "";
  console.log(`✓ PAMP: добавлено ${inserted}, обновлено ${updated}${suffix}`);
  console.log("Дальше: npm run data:export (или npm run build)");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

