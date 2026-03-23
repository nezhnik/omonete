/**
 * Импорт монет Germania Mint из data/germania-mint-*.json в таблицу coins.
 * Ключ обновления: source_url (канонический URL карточки товара).
 *
 * Запуск:
 *   node scripts/import-germania-mint-to-db.js
 *   node scripts/import-germania-mint-to-db.js data/germania-mint-foo.json
 */
require("dotenv").config({ path: ".env" });
const mysql = require("mysql2/promise");
const fs = require("fs");
const path = require("path");

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
      .filter((f) => f.startsWith("germania-mint-") && f.endsWith(".json") && !f.includes("listing-products"))
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
    const title = String(raw.title || "").trim();
    const { mintage, mintageDisplay } = parseMintage(specs.Mintage);
    const faceValue = specs.Denomination ? String(specs.Denomination).trim() : null;
    const quality = normalizeQuality(specs.Grade);
    const metalFineness = specs.Purity ? String(specs.Purity).trim() : null;
    const metal = metalFromPurity(metalFineness);
    const diameterMm = parseDiameterMm(specs.Diameter);
    const releaseDate = parseYearToDate(specs.Year);
    const country = countryFromData(sourceUrl, title);
    const series = specs.Series ? String(specs.Series).trim() : null;
    const imageObverse = raw.classified?.obverse || null;
    const imageReverse = raw.classified?.reverse || null;
    const weightOz = specs.Weight ? String(specs.Weight).trim() : null;
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
      null,
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
  }

  await conn.end();
  console.log(`✓ Germania Mint: добавлено ${inserted}, обновлено ${updated}`);
  console.log("Дальше: npm run data:export");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
