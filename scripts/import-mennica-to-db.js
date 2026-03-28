/**
 * Импорт Mennica Polska из data/mennica-*.json (без listing-products).
 * Ключ: source_url.
 *
 *   node scripts/import-mennica-to-db.js
 *   node scripts/import-mennica-to-db.js data/mennica-foo.json
 *   node scripts/import-mennica-to-db.js --force-images
 *     — снова скачать и пересобрать webp по URL из JSON даже если файл уже есть (без ручного rm; при ошибке скачивания/sharp старый файл сохраняется).
 */
require("dotenv").config({ path: ".env" });
const mysql = require("mysql2/promise");
const fs = require("fs");
const path = require("path");
const sharp = require("sharp");
const { finenessNumericOnly } = require("./format-coin-characteristics.js");
const { isExcludedMennicaProductUrl } = require("./mennica-excluded-product-urls.js");

const DATA_DIR = path.join(__dirname, "..", "data");
const FOREIGN_IMG_DIR = path.join(__dirname, "..", "public", "image", "coins", "foreign");

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
    const idx = parts.indexOf("product");
    if (idx >= 0 && parts[idx + 1]) return parts[idx + 1];
    return parts[parts.length - 1] || "item";
  } catch {
    return "item";
  }
}

/** Плоский доступ к спекам (EN/PL подписи на сайте). */
function specGet(specs, ...keys) {
  if (!specs || typeof specs !== "object") return null;
  for (const k of keys) {
    if (specs[k] != null && String(specs[k]).trim()) return String(specs[k]).trim();
    const found = Object.keys(specs).find((x) => x.toLowerCase() === String(k).toLowerCase());
    if (found && String(specs[found]).trim()) return String(specs[found]).trim();
  }
  return null;
}

function parseYearToDate(specs, title) {
  const y =
    specGet(specs, "Year", "Rok", "Date of issue", "Issue year", "Year of issue") ||
    (String(title || "").match(/\b(19|20)\d{2}\b/) || [])[0];
  return y && /^(19|20)\d{2}$/.test(y) ? `${y}-01-01` : null;
}

function parseMintage(raw) {
  const s = String(raw || "").trim();
  if (!s) return { mintage: null, mintageDisplay: null };
  const digits = s.replace(/[^\d]/g, "");
  const n = digits ? Number(digits) : null;
  return {
    mintage: Number.isFinite(n) && n > 0 ? n : null,
    mintageDisplay: s,
  };
}

function parseDiameterMm(s) {
  const m = String(s || "").replace(",", ".").match(/(\d+(?:\.\d+)?)/);
  return m ? m[1] : null;
}

function metalFromText(purity, metalLine) {
  const p = `${String(purity || "")} ${String(metalLine || "")}`.toUpperCase();
  if (/\bAU\b|GOLD|ZŁOT|ZLOT/i.test(p)) return "Золото";
  if (/\bAG\b|SILVER|SREBR/i.test(p)) return "Серебро";
  if (/\bPT\b|PLATIN|PLATYN/i.test(p)) return "Платина";
  if (/\bPD\b|PALLAD/i.test(p)) return "Палладий";
  return null;
}

function normalizeQuality(grade) {
  const s = String(grade || "").trim();
  if (!s) return null;
  if (/^bu$/i.test(s)) return "BU";
  if (/proof/i.test(s)) return "Proof";
  return s;
}

function parseNumberLike(raw) {
  if (raw == null) return null;
  const s = String(raw).replace(",", ".").trim();
  const m = s.match(/(\d+(?:\.\d+)?)/);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : null;
}

function deriveWeight(weightRaw, titleRaw) {
  const source = `${String(weightRaw || "").trim()} ${String(titleRaw || "").trim()}`.trim();
  if (!source) return { weightG: null, weightOz: null };
  const lower = source.toLowerCase();
  const n = parseNumberLike(source);
  if (!Number.isFinite(n) || n <= 0) return { weightG: null, weightOz: null };
  if (/\boz\b|ounce/i.test(lower)) {
    const weightG = Math.round(n * 31.1034768 * 100) / 100;
    return { weightG, weightOz: `${n} oz` };
  }
  if (/\bkg\b|kilo/i.test(lower)) {
    const weightG = Math.round(n * 1000 * 100) / 100;
    return { weightG, weightOz: `${Math.round(n * 32.1507466 * 1000) / 1000} oz` };
  }
  if (/\bg\b|gram/i.test(lower)) {
    const weightG = Math.round(n * 100) / 100;
    return { weightG, weightOz: `${Math.round((n / 31.1034768) * 1000) / 1000} oz` };
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
      headers: {
        "user-agent": "Mozilla/5.0 (compatible; omonete-bot/1.0)",
        referer: "https://inwestycje.mennica.com.pl/",
      },
    });
    if (!res.ok) return null;
    return Buffer.from(await res.arrayBuffer());
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

async function localizeForeignImage(url, fileBase, options = {}) {
  const force = options.force === true;
  if (!url || typeof url !== "string") return null;
  const raw = String(url).trim();
  if (!raw) return null;
  if (raw.startsWith("/image/coins/foreign/")) return raw;
  if (!/^https?:\/\//i.test(raw)) return null;

  ensureDir(FOREIGN_IMG_DIR);
  const safe = sanitizeFilePart(fileBase) || `mennica-${Date.now()}`;
  const fileName = `${safe}.webp`;
  const absOut = path.join(FOREIGN_IMG_DIR, fileName);
  const relOut = `/image/coins/foreign/${fileName}`;

  const hadExisting = fs.existsSync(absOut) && fs.statSync(absOut).size > 0;
  if (!force && hadExisting) return relOut;

  const buf = await fetchBuffer(raw);
  if (!buf || buf.length === 0) {
    if (hadExisting) return relOut;
    return null;
  }

  const tmp = `${absOut}.tmp.${process.pid}.${Date.now()}`;
  try {
    await sharp(buf).webp({ quality: 90 }).toFile(tmp);
    fs.renameSync(tmp, absOut);
    return relOut;
  } catch (e) {
    try {
      if (fs.existsSync(tmp)) fs.unlinkSync(tmp);
    } catch {
      /* ignore */
    }
    if (hadExisting) {
      console.warn("  [mennica import] sharp/запись, оставлен старый файл:", fileName, String(e && e.message ? e.message : e));
      return relOut;
    }
    return null;
  }
}

async function main() {
  const argv = process.argv.slice(2);
  const forceImages = argv.includes("--force-images");
  const jsonArg = argv.find((a) => a.endsWith(".json"));
  let files = [];
  if (jsonArg) {
    const p = path.isAbsolute(jsonArg) ? jsonArg : path.join(process.cwd(), jsonArg);
    if (!fs.existsSync(p)) throw new Error(`Файл не найден: ${p}`);
    files = [p];
  } else {
    files = fs
      .readdirSync(DATA_DIR)
      .filter((f) => f.startsWith("mennica-") && f.endsWith(".json") && !f.includes("listing-products"))
      .map((f) => path.join(DATA_DIR, f))
      .sort();
  }

  if (!files.length) {
    console.error("Нет data/mennica-*.json — сначала npm run mennica:fetch:all");
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

  for (const filePath of files) {
    let raw;
    try {
      raw = JSON.parse(fs.readFileSync(filePath, "utf8"));
    } catch {
      continue;
    }
    const sourceUrl = normalizeUrl(raw.source_url);
    if (!sourceUrl || !/mennica\.com\.pl/i.test(sourceUrl)) continue;
    if (isExcludedMennicaProductUrl(sourceUrl)) continue;

    const slug = slugFromUrl(sourceUrl);
    const specs = raw.specs || {};
    const title = String(raw.title || "").trim() || slug;

    const faceValue =
      specGet(specs, "Denomination", "Face value", "Nominal", "Wartość nominalna", "Nominal value") || "—";
    const purityRaw = specGet(specs, "Purity", "Fineness", "Próba", "Sample fineness");
    const metalLine = specGet(specs, "Metal", "Metal type", "Stop");
    const metal = metalFromText(purityRaw, metalLine);
    const metalFineness =
      finenessNumericOnly([purityRaw, metalLine].filter(Boolean).join(" ")) ||
      finenessNumericOnly(purityRaw || "") ||
      finenessNumericOnly(metalLine || "") ||
      null;

    const { mintage, mintageDisplay } = parseMintage(
      specGet(specs, "Mintage", "Nakład", "Limit", "Edition limit")
    );
    const quality = normalizeQuality(specGet(specs, "Grade", "Quality", "Stan", "Condition"));
    const diameterMm = parseDiameterMm(
      specGet(specs, "Diameter", "Dimension", "Średnica")
    );
    const releaseDate = parseYearToDate(specs, title);
    const weightStr = specGet(specs, "Weight", "Masa", "Mass");
    const { weightG, weightOz } = deriveWeight(weightStr, title);

    const listingLabel = String(raw.listing_label || "").trim();
    const series = listingLabel ? `Mennica Polska · ${listingLabel}` : "Mennica Polska";

    const imgOpts = { force: forceImages };
    const classified = raw.classified || {};
    const imageObverse = await localizeForeignImage(classified.obverse, `mennica-${slug}-obv`, imgOpts);
    const imageReverse = await localizeForeignImage(classified.reverse, `mennica-${slug}-rev`, imgOpts);
    const imageBlisterObv = await localizeForeignImage(
      classified.blister_obverse,
      `mennica-${slug}-blister-obv`,
      imgOpts
    );
    const imageBlisterRev = await localizeForeignImage(
      classified.blister_reverse,
      `mennica-${slug}-blister-rev`,
      imgOpts
    );
    const imagePackaging = await localizeForeignImage(classified.packaging, `mennica-${slug}-pack`, imgOpts);
    const imageBox = await localizeForeignImage(classified.box, `mennica-${slug}-box`, imgOpts);
    const imageCertificate = await localizeForeignImage(classified.certificate, `mennica-${slug}-cert`, imgOpts);

    const catalogNumber = `PL-MENNICA-${slug}`.toUpperCase().slice(0, 64);

    const values = [
      title,
      title,
      series,
      "Польша",
      faceValue,
      "Mennica Polska",
      "Mennica Polska",
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
      null,
      null,
      null,
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
  }

  await conn.end();
  console.log(`✓ Mennica Polska: добавлено ${inserted}, обновлено ${updated}`);
  if (forceImages) console.log("  (режим --force-images: картинки пересобраны по URL из JSON, при сбое сохранён прежний файл на диске)");
  console.log("Дальше: npm run data:export (или npm run build)");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
