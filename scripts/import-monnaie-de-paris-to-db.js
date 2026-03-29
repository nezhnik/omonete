/**
 * Импорт Monnaie de Paris из data/monnaie-de-paris-*.json (без listing-products / checkpoint).
 * Ключ: source_url (monnaiedeparis.fr). Картинки: classified + packaging[] → public/image/coins/foreign/*.webp
 *
 *   node scripts/import-monnaie-de-paris-to-db.js
 *   node scripts/import-monnaie-de-paris-to-db.js data/monnaie-de-paris-foo.json
 *   node scripts/import-monnaie-de-paris-to-db.js --force-images
 *   node scripts/import-monnaie-de-paris-to-db.js --force-packaging-images  — только pack/box (после mdp-patch-small-catalog-urls.js)
 *   В JSON: classified.packaging_box_only + один элемент packaging[] → только image_box, без pack.
 *   classified.packaging_no_box — не заполнять image_box (только pack), лишний slot box не показывать.
 */
require("dotenv").config({ path: ".env" });
const mysql = require("mysql2/promise");
const fs = require("fs");
const path = require("path");
const sharp = require("sharp");
const { finenessNumericOnly } = require("./format-coin-characteristics.js");
const { finalizeMintageForDb, logImportMintageSummary } = require("./parsing-mintage-constants.js");
const { slugFromUrl } = require("./fetch-monnaie-de-paris-product.js");

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

/** Как в других импортах: без query, для ключа в БД. */
function normalizeSourceKey(url) {
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

function mdpUrlPathKey(u) {
  if (!u || typeof u !== "string") return "";
  const t = u.trim();
  if (!t) return "";
  try {
    return new URL(t).pathname.toLowerCase();
  } catch {
    return t.split("?")[0].toLowerCase();
  }
}

/** Убрать из packaging те же кадры, что уже аверс/реверс (на MDP часто все подписи одинаковые — всё шло в `other`). */
function mdpPackagingUrlsOnlyExtra(classified) {
  const obv = classified.obverse;
  const rev = classified.reverse;
  const used = new Set([obv, rev].filter(Boolean).map(mdpUrlPathKey).filter(Boolean));
  const packs = classified.packaging;
  if (!Array.isArray(packs) || !packs.length) return [];
  const out = [];
  const seen = new Set();
  for (const p of packs) {
    const u = p && p.url ? String(p.url).trim() : "";
    if (!u) continue;
    const k = mdpUrlPathKey(u);
    if (used.has(k) || seen.has(k)) continue;
    seen.add(k);
    out.push(u);
  }
  return out;
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

function parseYearToDate(specs, title) {
  const raw =
    specGet(specs, "Millésime", "Millesime", "Year", "Year of issue", "Date of issue") ||
    (String(title || "").match(/\b(19|20)\d{2}\b/) || [])[0];
  return raw && /^(19|20)\d{2}$/.test(String(raw).trim()) ? `${String(raw).trim()}-01-01` : null;
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

function metalFromMdpSpec(metalLine) {
  const p = String(metalLine || "").toUpperCase();
  if (/\bAU\b|GOLD|OR\b/i.test(p)) return "Золото";
  if (/\bAG\b|SILVER|ARGENT/i.test(p)) return "Серебро";
  if (/\bCU\b|COPPER|CUIVRE/i.test(p)) return "Медь";
  if (/\bPT\b|PLATIN/i.test(p)) return "Платина";
  if (/\bPD\b|PALLAD/i.test(p)) return "Палладий";
  return null;
}

function normalizeQuality(grade) {
  const s = String(grade || "").trim();
  if (!s) return null;
  if (/^bu\b|brilliant\s*unc/i.test(s)) return "BU";
  if (/proof/i.test(s)) return "Proof";
  if (/uncirculated|non\s*circul|fleur\s*de\s*coin/i.test(s)) return s.replace(/\s+/g, " ");
  return s;
}

function parseNumberLike(raw) {
  if (raw == null) return null;
  const t = String(raw).replace(",", ".").trim();
  const m = t.match(/(\d+(?:\.\d+)?)/);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : null;
}

const TROY_OZ_GRAMS = 31.1034768;

/** Подпись «X oz» из граммов: без артефактов вроде 4.999 при 155,5 г (каталожные 5 oz). */
function troyOzDisplayFromGrams(grams) {
  const oz = grams / TROY_OZ_GRAMS;
  if (oz >= 1) {
    const nearest = Math.round(oz);
    if (Math.abs(oz - nearest) < 0.02) return `${nearest} oz`;
  }
  const rounded2 = Math.round(oz * 100) / 100;
  if (Math.abs(rounded2 - Math.round(rounded2)) < 1e-9) return `${Math.round(rounded2)} oz`;
  const s = rounded2.toFixed(2).replace(/\.?0+$/, "");
  return `${s} oz`;
}

/** Дробь или целые унции в заголовке (например «1/4 Oz», «1 Oz»). Не смешивать с полем Weight из спеков — иначе «7.78 g» + «1/4 Oz» в title давали ошибку: первое число 7.78 считалось унциями. */
function parseOzFromTitle(titleRaw) {
  const t = String(titleRaw || "");
  const frac = t.match(/\b(\d+)\s*\/\s*(\d+)\s*(?:oz|ounce)s?\b/i);
  if (frac) {
    const oz = Number(frac[1]) / Number(frac[2]);
    if (!Number.isFinite(oz) || oz <= 0) return null;
    const weightG = Math.round(oz * TROY_OZ_GRAMS * 100) / 100;
    const ozLabel = oz === 0.25 ? "0.25" : String(Math.round(oz * 10000) / 10000).replace(/\.?0+$/, "");
    return { weightG, weightOz: `${ozLabel} oz` };
  }
  const whole = t.match(/\b(\d+(?:\.\d+)?)\s*(?:oz|ounce)s?\b/i);
  if (whole) {
    const oz = Number(whole[1]);
    if (!Number.isFinite(oz) || oz <= 0) return null;
    const weightG = Math.round(oz * TROY_OZ_GRAMS * 100) / 100;
    return { weightG, weightOz: `${oz} oz` };
  }
  return null;
}

function deriveWeight(weightRaw, titleRaw) {
  const w = String(weightRaw || "").trim();
  const title = String(titleRaw || "").trim();

  // Сначала только строка веса из спеков: единицы («g», «oz») не должны подмешивать заголовок («1/4 Oz» в названии).
  if (w) {
    const lowerW = w.toLowerCase();
    const n = parseNumberLike(w);
    if (Number.isFinite(n) && n > 0) {
      if (/\boz\b|ounce/i.test(lowerW)) {
        const weightG = Math.round(n * TROY_OZ_GRAMS * 100) / 100;
        return { weightG, weightOz: `${n} oz` };
      }
      if (/\bkg\b|kilo/i.test(lowerW)) {
        const weightG = Math.round(n * 1000 * 100) / 100;
        return { weightG, weightOz: `${Math.round(n * 32.1507466 * 1000) / 1000} oz` };
      }
      if (/\bg\b|gram/i.test(lowerW)) {
        const weightG = Math.round(n * 100) / 100;
        return { weightG, weightOz: troyOzDisplayFromGrams(weightG) };
      }
      // Число без единицы в спеках MDP обычно в граммах
      const weightG = Math.round(n * 100) / 100;
      return { weightG, weightOz: troyOzDisplayFromGrams(weightG) };
    }
  }

  const fromTitle = parseOzFromTitle(title);
  if (fromTitle) return fromTitle;

  const source = title.trim();
  if (!source) return { weightG: null, weightOz: null };
  const lower = source.toLowerCase();
  const n = parseNumberLike(source);
  if (!Number.isFinite(n) || n <= 0) return { weightG: null, weightOz: null };
  if (/\boz\b|ounce/i.test(lower)) {
    const weightG = Math.round(n * TROY_OZ_GRAMS * 100) / 100;
    return { weightG, weightOz: `${n} oz` };
  }
  if (/\bkg\b|kilo/i.test(lower)) {
    const weightG = Math.round(n * 1000 * 100) / 100;
    return { weightG, weightOz: `${Math.round(n * 32.1507466 * 1000) / 1000} oz` };
  }
  if (/\bg\b|gram/i.test(lower)) {
    const weightG = Math.round(n * 100) / 100;
    return { weightG, weightOz: troyOzDisplayFromGrams(weightG) };
  }
  if (/^\s*\d/.test(source)) {
    const weightG = Math.round(n * 100) / 100;
    return { weightG, weightOz: troyOzDisplayFromGrams(weightG) };
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
        referer: "https://www.monnaiedeparis.fr/",
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
  const safe = sanitizeFilePart(fileBase) || `mdp-${Date.now()}`;
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
      console.warn("  [mdp import] sharp:", fileName, String(e && e.message ? e.message : e));
      return relOut;
    }
    return null;
  }
}

function catalogNumberFromRaw(raw, slug) {
  const sku = raw.sku != null && String(raw.sku).trim() ? String(raw.sku).trim().replace(/\s+/g, "") : null;
  const base = sku ? `FR-MDP-${sku}` : `FR-MDP-${slug}`;
  return base.toUpperCase().slice(0, 64);
}

async function main() {
  const argv = process.argv.slice(2);
  const forceImages = argv.includes("--force-images");
  const forcePackagingImages = argv.includes("--force-packaging-images");
  const jsonArg = argv.find((a) => a.endsWith(".json"));
  let files = [];
  if (jsonArg) {
    const p = path.isAbsolute(jsonArg) ? jsonArg : path.join(process.cwd(), jsonArg);
    if (!fs.existsSync(p)) throw new Error(`Файл не найден: ${p}`);
    files = [p];
  } else {
    files = fs
      .readdirSync(DATA_DIR)
      .filter(
        (f) =>
          f.startsWith("monnaie-de-paris-") &&
          f.endsWith(".json") &&
          !f.includes("listing-products") &&
          !f.includes("fetch-checkpoint")
      )
      .map((f) => path.join(DATA_DIR, f))
      .sort();
  }

  if (!files.length) {
    console.error("Нет data/monnaie-de-paris-*.json — сначала npm run mdp:fetch:all (или mdp:fetch:missing)");
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
    const sourceUrl = normalizeSourceKey(raw.source_url);
    if (!sourceUrl || !/monnaiedeparis\.fr/i.test(sourceUrl)) continue;

    const slug = slugFromUrl(sourceUrl);
    const specs = raw.specs && typeof raw.specs === "object" ? raw.specs : {};
    const title = String(raw.title_display || raw.title || "").trim() || slug;

    const faceValue =
      specGet(
        specs,
        "Valeur faciale",
        "Face value",
        "Denomination",
        "Nominal value"
      ) || "—";

    const metalLine = specGet(specs, "Metal", "Métal", "Alloy", "Alliage");
    const metal = metalFromMdpSpec(metalLine);
    const metalFineness =
      finenessNumericOnly(metalLine || "") ||
      finenessNumericOnly(specGet(specs, "Fineness", "Pureté", "Purity") || "") ||
      null;

    let { mintage, mintageDisplay } = parseMintage(
      specGet(specs, "Mintage", "Tirage", "Édition limitée")
    );
    ({ mintage, mintageDisplay } = finalizeMintageForDb(mintage, mintageDisplay, "Франция"));

    const quality = normalizeQuality(specGet(specs, "Qualité", "Quality", "Grade"));
    const diameterMm = parseDiameterMm(specGet(specs, "Diameter", "Diamètre", "Dimension"));
    const releaseDate = parseYearToDate(specs, title);
    const weightStr = specGet(specs, "Weight", "Poids", "Mass", "Masse");
    const { weightG, weightOz } = deriveWeight(weightStr, title);

    const seriesTitle = String(raw.series_title || "").trim();
    const listingLabel = String(raw.listing_label || "").trim();
    const series = [seriesTitle, listingLabel].filter(Boolean).join(" · ") || "Monnaie de Paris";

    const imgOpts = { force: forceImages };
    const classified = raw.classified || {};
    /** Одно фото упаковки только в слоте box (без pack), см. data JSON editors. */
    const packagingBoxOnly = classified.packaging_box_only === true;
    /** Есть второй URL в данных упаковки, но слот box на сайте не нужен. */
    const packagingNoBox = classified.packaging_no_box === true;

    const imageObverse = await localizeForeignImage(
      classified.obverse,
      `monnaie-de-paris-${slug}-obv`,
      imgOpts
    );
    const imageReverse = await localizeForeignImage(
      classified.reverse,
      `monnaie-de-paris-${slug}-rev`,
      imgOpts
    );

    let imagePackaging = null;
    let imageBox = null;
    const packUrls = mdpPackagingUrlsOnlyExtra(classified);
    const rawPacks = Array.isArray(classified.packaging) ? classified.packaging : [];
    const prevPackUrl =
      rawPacks[0] && rawPacks[0].url ? String(rawPacks[0].url).trim() : "";
    const prevBoxUrl =
      rawPacks[1] && rawPacks[1].url ? String(rawPacks[1].url).trim() : "";
    if (packUrls.length > 0) {
      if (packUrls.length === 1 && packagingBoxOnly) {
        const forceBox =
          forceImages ||
          forcePackagingImages ||
          (packUrls[0] &&
            prevPackUrl &&
            mdpUrlPathKey(packUrls[0]) !== mdpUrlPathKey(prevPackUrl));
        imagePackaging = null;
        imageBox = await localizeForeignImage(
          packUrls[0],
          `monnaie-de-paris-${slug}-box`,
          { ...imgOpts, force: forceBox }
        );
      } else {
        const forcePack =
          forceImages ||
          forcePackagingImages ||
          (packUrls[0] &&
            prevPackUrl &&
            mdpUrlPathKey(packUrls[0]) !== mdpUrlPathKey(prevPackUrl));
        const forceBox =
          forceImages ||
          forcePackagingImages ||
          (packUrls[1] &&
            prevBoxUrl &&
            mdpUrlPathKey(packUrls[1]) !== mdpUrlPathKey(prevBoxUrl));
        imagePackaging = await localizeForeignImage(
          packUrls[0],
          `monnaie-de-paris-${slug}-pack`,
          { ...imgOpts, force: forcePack }
        );
        if (packUrls[1] && !packagingNoBox) {
          imageBox = await localizeForeignImage(
            packUrls[1],
            `monnaie-de-paris-${slug}-box`,
            { ...imgOpts, force: forceBox }
          );
        }
      }
    } else if (classified.packaging && typeof classified.packaging === "string") {
      imagePackaging = await localizeForeignImage(
        classified.packaging,
        `monnaie-de-paris-${slug}-pack`,
        { ...imgOpts, force: forceImages || forcePackagingImages }
      );
    }

    const catalogNumber = catalogNumberFromRaw(raw, slug);
    const priceDisplay = String(raw.price_display || "").trim() || null;

    const values = [
      title,
      title,
      series,
      "Франция",
      faceValue,
      "Monnaie de Paris",
      "Monnaie de Paris",
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
      null,
      null,
      imagePackaging,
      imageBox,
      null,
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
  logImportMintageSummary("Monnaie de Paris", mintageStats);
  console.log(`✓ Monnaie de Paris: добавлено ${inserted}, обновлено ${updated}`);
  if (forceImages) console.log("  (--force-images)");
  if (forcePackagingImages) console.log("  (--force-packaging-images)");
  console.log("Дальше: npm run data:export:incremental (или npm run build)");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
