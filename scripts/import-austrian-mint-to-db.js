/**
 * Импорт Münze Österreich из data/austrian-mint-*.json (без listing-products).
 * Ключ: source_url (muenzeoesterreich.com). Характеристики: raw.specs и/или accordionPlain.Specifications (простой текст с сайта).
 *
 *   node scripts/import-austrian-mint-to-db.js
 *   node scripts/import-austrian-mint-to-db.js data/austrian-mint-foo.json
 *   node scripts/import-austrian-mint-to-db.js --force-images
 */
require("dotenv").config({ path: ".env" });
const mysql = require("mysql2/promise");
const fs = require("fs");
const path = require("path");
const sharp = require("sharp");
const { finenessNumericOnly } = require("./format-coin-characteristics.js");
const { finalizeMintageForDb, logImportMintageSummary } = require("./parsing-mintage-constants.js");

const DATA_DIR = path.join(__dirname, "..", "data");
const FOREIGN_IMG_DIR = path.join(__dirname, "..", "public", "image", "coins", "foreign");

const SPEC_LABELS = [
  "Mintage (Special Uncirculated)",
  "Mintage (Uncirculated)",
  "Mintage (Proof)",
  "Product No.",
  "Date of Issue",
  "Quality",
  "Series",
  "Serie",
  "Face Value",
  "Diameter",
  "Coin Design",
  "Alloy",
  "Fine Weight",
  "Total Weight",
  "Packaging",
].sort((a, b) => b.length - a.length);

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

function slugFromProductsUrl(url) {
  try {
    const u = new URL(url);
    const parts = u.pathname.split("/").filter(Boolean);
    const idx = parts.indexOf("products");
    if (idx >= 0 && parts[idx + 1]) return parts[idx + 1];
    return parts[parts.length - 1] || "item";
  } catch {
    return "item";
  }
}

/** Разбор строки Specifications с PDP (пробелы вместо табов после рендера). */
function parseSpecificationsBlob(blob) {
  const flat = String(blob || "").replace(/\s+/g, " ").trim();
  if (!flat) return {};
  const out = {};
  const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = SPEC_LABELS.map((L) => esc(L)).join("|");
  const re = new RegExp(`(${pattern})`, "g");
  const hits = [];
  let m;
  while ((m = re.exec(flat)) !== null) {
    hits.push({ label: m[1], start: m.index });
  }
  for (let i = 0; i < hits.length; i++) {
    const { label, start } = hits[i];
    const valStart = start + label.length;
    const valEnd = i + 1 < hits.length ? hits[i + 1].start : flat.length;
    const val = flat.slice(valStart, valEnd).trim();
    if (val && out[label] == null) out[label] = val;
  }
  return out;
}

function mergedSpecs(raw) {
  const base = { ...(raw.specs && typeof raw.specs === "object" ? raw.specs : {}) };
  const ap = raw.accordionPlain && typeof raw.accordionPlain === "object" ? raw.accordionPlain : {};
  const blob = ap.Specifications || ap.specifications;
  if (typeof blob === "string" && blob.trim()) {
    const parsed = parseSpecificationsBlob(blob);
    for (const [k, v] of Object.entries(parsed)) {
      if (base[k] == null && v) base[k] = v;
    }
  }
  return base;
}

function specGet(specs, ...keys) {
  if (!specs || typeof specs !== "object") return null;
  for (const k of keys) {
    if (specs[k] != null && String(specs[k]).trim()) return String(specs[k]).trim();
    const found = Object.keys(specs).find((x) => x.toLowerCase() === String(k).toLowerCase());
    if (found && String(specs[found]).trim()) return String(specs[found]).trim();
  }
  return null;
}

function parseReleaseDate(specs, title) {
  const raw = specGet(specs, "Date of Issue", "Date of issue");
  if (raw) {
    const t = Date.parse(raw);
    if (!Number.isNaN(t)) {
      const d = new Date(t);
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    }
    const y = raw.match(/\b(19|20)\d{2}\b/);
    if (y) return `${y[0]}-01-01`;
  }
  const y2 = String(title || "").match(/\b(19|20)\d{2}\b/);
  return y2 ? `${y2[0]}-01-01` : null;
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

function metalFromAlloy(alloy) {
  const p = String(alloy || "").toUpperCase();
  if (/\bAU\b|GOLD/i.test(p)) return "Золото";
  if (/\bAG\b|SILVER/i.test(p)) return "Серебро";
  if (/\bCU\b|COPPER/i.test(p)) return "Медь";
  if (/NIOBIUM/i.test(p)) return "Серебро";
  return null;
}

function normalizeQuality(grade) {
  const s = String(grade || "").trim();
  if (!s) return null;
  if (/^proof$/i.test(s)) return "Proof";
  if (/special uncirculated|uncirculated/i.test(s)) return s.replace(/\s+/g, " ");
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

function deriveWeightFromFineTotal(fineRaw, totalRaw, titleRaw) {
  const fine = String(fineRaw || "").trim();
  const total = String(totalRaw || "").trim();
  const src = fine || total || String(titleRaw || "");
  const lower = src.toLowerCase();
  const n = parseNumberLike(src);
  if (!Number.isFinite(n) || n <= 0) return { weightG: null, weightOz: null };
  if (/\boz\b|ounce/i.test(lower)) {
    const weightG = Math.round(n * 31.1034768 * 100) / 100;
    return { weightG, weightOz: `${n} oz` };
  }
  if (/\bg\b|gram/i.test(lower) || (!/\boz\b/i.test(lower) && /^\s*\d/.test(src))) {
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
        referer: "https://www.muenzeoesterreich.com/",
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
  const safe = sanitizeFilePart(fileBase) || `austrian-mint-${Date.now()}`;
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
      console.warn("  [austrian-mint import] sharp:", fileName, String(e && e.message ? e.message : e));
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
      .filter((f) => f.startsWith("austrian-mint-") && f.endsWith(".json") && !f.includes("listing-products"))
      .map((f) => path.join(DATA_DIR, f))
      .sort();
  }

  if (!files.length) {
    console.error("Нет data/austrian-mint-*.json — сначала npm run austrian-mint:fetch:all");
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
    "price_display",
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
    if (!sourceUrl || !/muenzeoesterreich\.com/i.test(sourceUrl)) continue;

    const slug = slugFromProductsUrl(sourceUrl);
    const specs = mergedSpecs(raw);
    const title = String(raw.title || "").trim() || slug;

    const faceValue = specGet(specs, "Face Value", "Face value") || "—";
    const alloy = specGet(specs, "Alloy");
    const metal = metalFromAlloy(alloy);
    const metalFineness =
      finenessNumericOnly(alloy || "") || finenessNumericOnly(specGet(specs, "Purity", "Fineness") || "") || null;

    const mintageProof = specGet(specs, "Mintage (Proof)");
    const mintageSU = specGet(specs, "Mintage (Special Uncirculated)");
    const mintageUnc = specGet(specs, "Mintage (Uncirculated)");
    const mintageRaw = mintageProof || mintageSU || mintageUnc || specGet(specs, "Mintage");
    let { mintage, mintageDisplay } = parseMintage(mintageRaw);
    ({ mintage, mintageDisplay } = finalizeMintageForDb(mintage, mintageDisplay, "Австрия"));

    const quality = normalizeQuality(specGet(specs, "Quality"));
    const diameterMm = parseDiameterMm(specGet(specs, "Diameter"));
    const releaseDate = parseReleaseDate(specs, title);
    const fineW = specGet(specs, "Fine Weight");
    const totalW = specGet(specs, "Total Weight");
    const { weightG, weightOz } = deriveWeightFromFineTotal(fineW, totalW, title);

    const seriesSite = specGet(specs, "Series", "Serie");
    const listingLabel = String(raw.listing_label || "").trim();
    const series = [seriesSite, listingLabel].filter(Boolean).join(" · ") || "Münze Österreich";

    const imgOpts = { force: forceImages };
    const classified = raw.classified || {};
    const imageObverse = await localizeForeignImage(classified.obverse, `austrian-mint-${slug}-obv`, imgOpts);
    const imageReverse = await localizeForeignImage(classified.reverse, `austrian-mint-${slug}-rev`, imgOpts);
    const imageBlisterObv = await localizeForeignImage(
      classified.blister_obverse,
      `austrian-mint-${slug}-blister-obv`,
      imgOpts
    );
    const imageBlisterRev = await localizeForeignImage(
      classified.blister_reverse,
      `austrian-mint-${slug}-blister-rev`,
      imgOpts
    );
    const imagePackaging = await localizeForeignImage(classified.packaging, `austrian-mint-${slug}-pack`, imgOpts);
    const imageBox = await localizeForeignImage(classified.box, `austrian-mint-${slug}-box`, imgOpts);
    const imageCertificate = await localizeForeignImage(classified.certificate, `austrian-mint-${slug}-cert`, imgOpts);

    const catBase = `AT-MUENZE-${slug}`.toUpperCase();
    const catalogNumber = catBase.length <= 64 ? catBase : catBase.slice(0, 64);

    const priceDisplay = String(raw.price_display || "").trim() || null;

    const values = [
      title,
      title,
      series,
      "Австрия",
      faceValue,
      "Münze Österreich",
      "Münze Österreich",
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
      priceDisplay,
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
  logImportMintageSummary("Münze Österreich", mintageStats);
  console.log(`✓ Münze Österreich: добавлено ${inserted}, обновлено ${updated}`);
  if (forceImages) console.log("  (--force-images)");
  console.log("Дальше: npm run data:export:incremental (или npm run build)");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
