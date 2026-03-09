/**
 * Выгружает данные монет из БД в статические JSON для деплоя без Node.
 * Пишет: public/data/coins.json (список), public/data/coin-ids.json (id для generateStaticParams), public/data/coins/<id>.json (детали).
 * Запускается перед build (prebuild) или вручную: node scripts/export-coins-to-json.js
 */
require("dotenv").config({ path: ".env" });
const crypto = require("crypto");
const mysql = require("mysql2/promise");
const fs = require("fs");
const path = require("path");
const { roundSpec, formatWeightG, stripCountryFromFaceValue } = require("./format-coin-characteristics.js");

const PLACEHOLDER = "/image/coin-placeholder.png";
// Чужая картинка набора 2013 — не подставлять в другие монеты (см. fix-wrong-3-coin-set-image.js)
const WRONG_3_COIN_SET_PATH = "2013-australian-kookaburra-kangaroo-koala-high-relief-silver-pr-99-9-1-oz-3-coin-set";
const STATE_FILE = path.join(__dirname, "..", "export-state.json");
const DATA_DIR = path.join(__dirname, "..", "public", "data");
const COINS_DIR = path.join(DATA_DIR, "coins");

// Только свои пути из БД. URL ЦБ не используем — на сайте только монеты с картинками в БД.
function obverseUrl(imageObverse) {
  if (imageObverse && String(imageObverse).trim()) return imageObverse.trim();
  return null;
}
function reverseUrl(imageReverse) {
  if (imageReverse && String(imageReverse).trim()) return imageReverse.trim();
  return null;
}
function firstImageUrl(imageUrls, _catalogNumber, imageObverse) {
  if (imageObverse && String(imageObverse).trim()) return imageObverse.trim();
  if (Array.isArray(imageUrls) && imageUrls[0]) return imageUrls[0];
  return null;
}

/** Убирает из названия HTML-теги и сущности ЦБ: <nobr>, &nbsp; */
function cleanTitle(s) {
  if (s == null || typeof s !== "string") return "";
  return s
    .replace(/<nobr>/gi, "")
    .replace(/<\/nobr>/gi, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Год из суффикса каталога: "26" → 2026, "98" → 1998. 00–30 → 2000-е, 31–99 → 1900-е. */
function yearFromCatalogSuffix(suffix) {
  if (suffix == null || String(suffix).length !== 2) return null;
  const yy = parseInt(String(suffix), 10);
  if (Number.isNaN(yy) || yy < 0 || yy > 99) return null;
  return yy <= 30 ? 2000 + yy : 1900 + yy;
}

/** Год из названия монеты (например "Giant Centipede 2026" → 2026), если в БД год не задан. */
function yearFromTitle(title) {
  const s = title != null ? String(title).trim() : "";
  if (!s) return null;
  const m = s.match(/(20\d{2}|19\d{2})/);
  return m ? parseInt(m[1], 10) : null;
}

/** Числовые характеристики — до 1 знака: 31.107 → "31.1". */
function formatSpecNum(v) {
  if (v == null || v === "") return undefined;
  const r = roundSpec(v);
  return r != null ? String(r) : String(v).trim();
}

/** Убирает пробу из строки металла: "серебро 925/1000" → "Серебро". Проба остаётся в metal_fineness. */
function metalOnly(str) {
  if (!str || typeof str !== "string") return str ?? "—";
  const cleaned = str.replace(/\s*\d{3,4}(\/\d{3,4})?\s*/g, "").trim();
  if (!cleaned) return "—";
  return cleaned.charAt(0).toUpperCase() + cleaned.slice(1).toLowerCase();
}

const METAL_CODE_MAP = [
  { pattern: /золото/i, code: "Au", color: "#FFD700" },
  { pattern: /платина/i, code: "Pt", color: "#E5E4E2" },
  { pattern: /палладий/i, code: "Pd", color: "#CEC5B4" },
  { pattern: /серебро/i, code: "Ag", color: "#C0C0C0" },
  { pattern: /медь/i, code: "Cu", color: "#97564A" },
];
function getMetalCodeAndColor(metalStr) {
  if (!metalStr || typeof metalStr !== "string") return { code: null, color: null };
  const m = metalStr.toLowerCase().trim();
  for (const { pattern, code, color } of METAL_CODE_MAP) {
    if (pattern.test(m)) return { code, color };
  }
  return { code: null, color: null };
}

/** Для биметалла (золото+серебро) возвращает ["Au", "Ag"]; иначе [code] по первому совпадению. Нужно для фильтра каталога. */
function getMetalCodes(metalStr) {
  if (!metalStr || typeof metalStr !== "string") return [];
  const m = metalStr.toLowerCase().trim();
  const hasGold = /золото/i.test(m);
  const hasSilver = /серебро/i.test(m);
  if (hasGold && hasSilver) return ["Au", "Ag"];
  const { code } = getMetalCodeAndColor(metalStr);
  return code ? [code] : [];
}

// Стандартные веса: килограммы пишем как 1 кг, 3 кг, 5 кг (в унции не переводим); остальное в унциях.
const WEIGHT_LABELS = [
  { g: 5000, label: "5 кг · 5000 грамм", tol: 20 },
  { g: 3000, label: "3 кг · 3000 грамм", tol: 15 },
  { g: 1000, label: "1 кг · 1000 грамм", tol: 5 },
  { g: 311.03, label: "10 унций · 311 г", tol: 2 },
  { g: 155.52, label: "5 унций · 155,5 г", tol: 1.5 },
  { g: 93.31, label: "3 унции · 93,3 г", tol: 1 },
  { g: 62.21, label: "2 унции · 62,2 г", tol: 1 },
  { g: 31.1, label: "1 унция · 31,1 грамм", tol: 0.2 },
  { g: 15.55, label: "1/2 унции · 15,55 грамм", tol: 0.2 },
  { g: 7.78, label: "1/4 унции · 7,78 грамм", tol: 0.2 },
  { g: 6.22, label: "1/5 унции · 6,22 грамм", tol: 0.2 },
  { g: 3.89, label: "1/8 унции · 3,89 грамм", tol: 0.2 },
  { g: 3.11, label: "1/10 унции · 3,11 грамм", tol: 0.2 },
  { g: 1.24, label: "1/25 унции · 1,24 грамм", tol: 0.05 },
  { g: 1, label: "1/31,1 унции · 1 грамм", tol: 0.05 },
  { g: 0.5, label: "1/62,2 унции · 0,5 грамм", tol: 0.05 },
  { g: 0.31, label: "1/100 унции · 0,31 грамм", tol: 0.02 },
  { g: 0.156, label: "1/200 унции · 0,156 грамм", tol: 0.01 },
  { g: 0.031, label: "1/1000 унции · 0,031 грамм", tol: 0.005 },
];
/** Извлекает число грамм из строки вида "31,1", "31,1 г", "33,94 (±0,31)". */
function parseWeightG(weightG) {
  if (weightG == null || weightG === "") return null;
  const s = String(weightG).trim().replace(",", ".");
  const match = s.match(/^\s*(\d+(?:\.\d+)?)/);
  if (!match) return null;
  const g = parseFloat(match[1]);
  return Number.isNaN(g) ? null : g;
}
/** Сопоставление значений weight_oz из БД с подписями для фильтра. */
const WEIGHT_OZ_TO_LABEL = {
  "5 кг": "5 кг · 5000 грамм",
  "3 кг": "3 кг · 3000 грамм",
  "1 кг": "1 кг · 1000 грамм",
  "10 унций": "10 унций · 311 г",
  "5 унций": "5 унций · 155,5 г",
  "3 унции": "3 унции · 93,3 г",
  "2 унции": "2 унции · 62,2 г",
  "1 унция": "1 унция · 31,1 грамм",
  "1/2 унции": "1/2 унции · 15,55 грамм",
  "1/4 унции": "1/4 унции · 7,78 грамм",
  "1/5 унции": "1/5 унции · 6,22 грамм",
  "1/5": "1/5 унции · 6,22 грамм",
  "1/8 унции": "1/8 унции · 3,89 грамм",
  "1/10 унции": "1/10 унции · 3,11 грамм",
  "1/25 унции": "1/25 унции · 1,24 грамм",
  "1/100 унции": "1/100 унции · 0,31 грамм",
  "1/100": "1/100 унции · 0,31 грамм",
  "1/200 унции": "1/200 унции · 0,156 грамм",
  "1/1000 унции": "1/1000 унции · 0,031 грамм",
  "1/1000": "1/1000 унции · 0,031 грамм",
  "1/31,1 унции": "1/31,1 унции · 1 грамм",
  "1/31.1": "1/31,1 унции · 1 грамм",
  "1/31,1": "1/31,1 унции · 1 грамм",
  "1 г": "1/31,1 унции · 1 грамм",
  "1/62,2 унции": "1/62,2 унции · 0,5 грамм",
  "1/62.2": "1/62,2 унции · 0,5 грамм",
  "1/62,2": "1/62,2 унции · 0,5 грамм",
  "0,5 г": "1/62,2 унции · 0,5 грамм",
};
function getWeightLabel(weightG, weightOz) {
  const oz = weightOz && String(weightOz).trim();
  if (oz && WEIGHT_OZ_TO_LABEL[oz]) return WEIGHT_OZ_TO_LABEL[oz];
  const g = parseWeightG(weightG);
  if (g == null) return null;
  for (const { g: ref, label, tol = 0.2 } of WEIGHT_LABELS) {
    if (Math.abs(g - ref) <= tol) return label;
  }
  return null;
}

function hasImage(r) {
  const ob = r.image_obverse && String(r.image_obverse).trim();
  const rev = r.image_reverse && String(r.image_reverse).trim();
  return !!(ob && rev);
}

/** Экспортируем все монеты. Без картинок — placeholder. Иностранные монеты добавляются сначала без изображений. */

/** Какую сторону показывать первой. По умолчанию — firstImage; для дворов из firstImageReverseMints — "reverse" (напр. Perth). */
function getFirstImageSide(mint) {
  try {
    const p = path.join(__dirname, "..", "coin-display-config.json");
    const data = JSON.parse(fs.readFileSync(p, "utf8"));
    const reverseMints = Array.isArray(data.firstImageReverseMints) ? data.firstImageReverseMints.map((x) => String(x).trim()) : [];
    const mintStr = mint != null && String(mint).trim() ? String(mint).trim() : "";
    if (mintStr && reverseMints.some((m) => m === mintStr)) return "reverse";
    return data.firstImage === "reverse" ? "reverse" : "obverse";
  } catch {
    return "obverse";
  }
}

/** Монеты с квадратной/прямоугольной формой: catalog_number из rectangular-coins.json (сопоставляем по base). */
function getRectangularCatalogBases() {
  try {
    const p = path.join(__dirname, "..", "rectangular-coins.json");
    const arr = JSON.parse(fs.readFileSync(p, "utf8"));
    return Array.isArray(arr) ? arr.map((x) => String(x).trim()).filter(Boolean) : [];
  } catch {
    return [];
  }
}

/** Прямоугольные по id (иностранные, напр. Stranger Things Season 1–4). */
function getRectangularCoinIds() {
  try {
    const p = path.join(__dirname, "..", "rectangular-coin-ids.json");
    const arr = JSON.parse(fs.readFileSync(p, "utf8"));
    return Array.isArray(arr) ? arr.map((x) => String(x).trim()).filter(Boolean) : [];
  } catch {
    return [];
  }
}

function isRectangularCoin(catalogNumber, rectangularBases, rectangularIds, id, lengthMm, widthMm) {
  if (id && rectangularIds.length > 0 && rectangularIds.includes(String(id))) return true;
  const hasLen = lengthMm != null && String(lengthMm).trim() !== "";
  const hasWid = widthMm != null && String(widthMm).trim() !== "";
  if (hasLen && hasWid) return true;
  if (!catalogNumber || rectangularBases.length === 0) return false;
  const cat = String(catalogNumber).trim();
  return rectangularBases.some((base) => cat === base || cat.startsWith(base + "-"));
}

async function run() {
  const incremental = process.argv.includes("--incremental");
  if (incremental) console.log("Режим: инкрементальный (только изменённые/новые)");

  console.log("Первая картинка: по конфигу (obverse по умолчанию, reverse для firstImageReverseMints)");
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

  const conn = await mysql.createConnection({
    host,
    port: parseInt(port, 10),
    user,
    password,
    database,
  });

  let mintLogoMap = new Map();
  let mintsList = [];
  try {
    const [mintRows] = await conn.execute("SELECT name, logo_url, id, slug, country FROM mints");
    mintRows.forEach((m) => {
      if (m.name && m.logo_url) mintLogoMap.set(String(m.name).trim(), m.logo_url);
      mintsList.push({ id: m.slug || String(m.id), name: m.name, slug: m.slug, logo_url: m.logo_url || null, country: m.country || "Россия" });
    });
  } catch (e) {
    if (e.code !== "ER_NO_SUCH_TABLE") throw e;
  }

  let rows;
  try {
    [rows] = await conn.execute(
      `SELECT id, title, title_en, series, country, face_value, release_date, image_urls, catalog_number, catalog_suffix, image_obverse, image_reverse, image_box, image_certificate, mint, mint_short, metal, metal_fineness, mintage, mintage_display, weight_g, weight_oz, quality, diameter_mm, thickness_mm, length_mm, width_mm, price_display
       FROM coins ORDER BY release_date DESC, id DESC`
    );
  } catch (err) {
    if (err.code === "ER_BAD_FIELD_ERROR") {
      if (/price_display/.test(err.message)) {
        [rows] = await conn.execute(
          `SELECT id, title, title_en, series, country, face_value, release_date, image_urls, catalog_number, catalog_suffix, image_obverse, image_reverse, image_box, image_certificate, mint, mint_short, metal, metal_fineness, mintage, mintage_display, weight_g, weight_oz, quality, diameter_mm, thickness_mm, length_mm, width_mm
           FROM coins ORDER BY release_date DESC, id DESC`
        );
        rows.forEach((r) => { r.price_display = null; });
      } else if (/weight_oz/.test(err.message)) {
        [rows] = await conn.execute(
          `SELECT id, title, series, country, face_value, release_date, image_urls, catalog_number, image_obverse, image_reverse, image_box, image_certificate, mint, metal, metal_fineness, mintage, weight_g
           FROM coins ORDER BY release_date DESC, id DESC`
        );
        rows.forEach((r) => { r.weight_oz = null; r.quality = null; r.diameter_mm = null; r.thickness_mm = null; r.length_mm = null; r.width_mm = null; r.mintage_display = null; r.catalog_suffix = null; });
      } else if (/quality|diameter_mm|thickness_mm/.test(err.message)) {
        [rows] = await conn.execute(
          `SELECT id, title, series, country, face_value, release_date, image_urls, catalog_number, image_obverse, image_reverse, image_box, image_certificate, mint, metal, metal_fineness, mintage, weight_g, weight_oz
           FROM coins ORDER BY release_date DESC, id DESC`
        );
        rows.forEach((r) => { r.quality = null; r.diameter_mm = null; r.thickness_mm = null; r.length_mm = null; r.width_mm = null; r.mintage_display = null; r.catalog_suffix = null; });
      } else if (/mintage_display/.test(err.message)) {
        [rows] = await conn.execute(
          `SELECT id, title, series, country, face_value, release_date, image_urls, catalog_number, catalog_suffix, image_obverse, image_reverse, image_box, image_certificate, mint, mint_short, metal, metal_fineness, mintage, weight_g, weight_oz, quality, diameter_mm, thickness_mm, length_mm, width_mm
           FROM coins ORDER BY release_date DESC, id DESC`
        );
        rows.forEach((r) => { r.mintage_display = null; });
      } else if (/catalog_suffix/.test(err.message)) {
        [rows] = await conn.execute(
          `SELECT id, title, series, country, face_value, release_date, image_urls, catalog_number, image_obverse, image_reverse, image_box, image_certificate, mint, metal, metal_fineness, mintage, mintage_display, weight_g, weight_oz, quality, diameter_mm, thickness_mm
           FROM coins ORDER BY release_date DESC, id DESC`
        );
        rows.forEach((r) => { r.catalog_suffix = null; });
      } else if (/length_mm|width_mm/.test(err.message)) {
        [rows] = await conn.execute(
          `SELECT id, title, series, country, face_value, release_date, image_urls, catalog_number, catalog_suffix, image_obverse, image_reverse, image_box, image_certificate, mint, mint_short, metal, metal_fineness, mintage, mintage_display, weight_g, weight_oz, quality, diameter_mm, thickness_mm
           FROM coins ORDER BY release_date DESC, id DESC`
        );
        rows.forEach((r) => { r.length_mm = null; r.width_mm = null; });
      } else if (/mint_short/.test(err.message)) {
        [rows] = await conn.execute(
          `SELECT id, title, series, country, face_value, release_date, image_urls, catalog_number, catalog_suffix, image_obverse, image_reverse, image_box, image_certificate, mint, metal, metal_fineness, mintage, mintage_display, weight_g, weight_oz, quality, diameter_mm, thickness_mm, length_mm, width_mm
           FROM coins ORDER BY release_date DESC, id DESC`
        );
        rows.forEach((r) => { r.mint_short = null; });
      } else if (/title_en/.test(err.message)) {
        [rows] = await conn.execute(
          `SELECT id, title, series, country, face_value, release_date, image_urls, catalog_number, catalog_suffix, image_obverse, image_reverse, image_box, image_certificate, mint, mint_short, metal, metal_fineness, mintage, mintage_display, weight_g, weight_oz, quality, diameter_mm, thickness_mm, length_mm, width_mm
           FROM coins ORDER BY release_date DESC, id DESC`
        );
        rows.forEach((r) => { r.title_en = null; });
      } else {
        throw err;
      }
    } else {
      throw err;
    }
  }
  // Монеты без тиража не выводим в каталог (считаем, что их нет)
  const rowsToExport = rows.filter((r) => r.mintage != null && Number(r.mintage) !== 0);
  const rectangularBases = getRectangularCatalogBases();
  const rectangularIds = getRectangularCoinIds();

  const listCoins = rowsToExport.map((r) => {
    const firstImageSide = getFirstImageSide(r.mint);
    const imageObverse = r.image_obverse;
    const imageReverse = r.image_reverse;
    const imageUrls = r.image_urls;
    const imageBox = r.image_box;
    const imageCertificate = r.image_certificate;
    const releaseDate = r.release_date;
    const year =
      yearFromCatalogSuffix(r.catalog_suffix) ??
      (releaseDate ? new Date(releaseDate).getFullYear() : null) ??
      yearFromTitle(r.title) ??
      0;
    const isThreeCoinSet = (r.title || "").includes("Three Coin Set") || (r.title || "").includes("3 Coin Set");
    const dropWrong = (u) => u && !isThreeCoinSet && String(u).includes(WRONG_3_COIN_SET_PATH) ? null : u;
    const reverse = dropWrong(reverseUrl(imageReverse));
    const obverse = dropWrong(obverseUrl(imageObverse));
    const imageUrl = firstImageSide === "reverse" ? (reverse ?? obverse ?? PLACEHOLDER) : (obverse ?? reverse ?? PLACEHOLDER);
    const imageUrlsOut = [];
    const imageUrlRoles = [];
    const pushIfNew = (url, role) => {
      if (!url || imageUrlsOut.includes(url)) return;
      imageUrlsOut.push(url);
      imageUrlRoles.push(role);
    };
    if (firstImageSide === "reverse") {
      if (reverse) pushIfNew(reverse, "reverse");
      if (obverse) pushIfNew(obverse, "obverse");
    } else {
      if (obverse) pushIfNew(obverse, "obverse");
      if (reverse) pushIfNew(reverse, "reverse");
    }
    if (imageBox?.trim()) pushIfNew(imageBox.trim(), "box");
    if (imageCertificate?.trim()) pushIfNew(imageCertificate.trim(), "certificate");
    if (imageUrlsOut.length === 0 && Array.isArray(imageUrls) && imageUrls.length > 0) {
      const filtered = isThreeCoinSet ? imageUrls : imageUrls.filter((u) => !String(u).includes(WRONG_3_COIN_SET_PATH));
      if (filtered.length > 0) imageUrlsOut.push(...filtered);
    }
    const { code: metalCode } = getMetalCodeAndColor(r.metal);
    const metalCodes = getMetalCodes(r.metal);
    const weightLabel = getWeightLabel(r.weight_g, r.weight_oz);
    const weightG = parseWeightG(r.weight_g);
    const metalLabelStr = metalOnly(r.metal);
    return {
      id: String(r.id),
      title: cleanTitle(r.title),
      titleEn: r.title_en && String(r.title_en).trim() ? String(r.title_en).trim() : undefined,
      country: r.country ?? "Россия",
      year: year ?? 0,
      faceValue: (stripCountryFromFaceValue(r.face_value) || r.face_value) ?? undefined,
      imageUrl,
      imageUrls: imageUrlsOut.length > 0 ? imageUrlsOut : undefined,
      imageUrlRoles: imageUrlRoles.length > 0 ? imageUrlRoles : undefined,
      seriesName: r.series ?? undefined,
      metalCode: metalCode ?? undefined,
      metalCodes: metalCodes.length > 0 ? metalCodes : undefined,
      metalLabel: metalLabelStr && metalLabelStr !== "—" ? metalLabelStr : undefined,
      mintName: r.mint && String(r.mint).trim() ? String(r.mint).trim() : undefined,
      mintShort: r.mint_short && String(r.mint_short).trim() ? String(r.mint_short).trim() : undefined,
      mintLogoUrl: r.mint && mintLogoMap.get(String(r.mint).trim()) ? mintLogoMap.get(String(r.mint).trim()) : undefined,
      weightLabel: weightLabel ?? undefined,
      weightG: weightG ?? undefined,
      rectangular: isRectangularCoin(r.catalog_number, rectangularBases, rectangularIds, r.id, r.length_mm, r.width_mm),
    };
  });

  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(COINS_DIR)) fs.mkdirSync(COINS_DIR, { recursive: true });

  fs.writeFileSync(
    path.join(DATA_DIR, "coins.json"),
    JSON.stringify({ coins: listCoins, total: listCoins.length })
  );
  console.log("✓ public/data/coins.json");

  fs.writeFileSync(
    path.join(DATA_DIR, "coin-ids.json"),
    JSON.stringify(listCoins.map((c) => c.id))
  );
  console.log("✓ public/data/coin-ids.json");

  if (mintsList.length > 0) {
    fs.writeFileSync(path.join(DATA_DIR, "mints.json"), JSON.stringify({ mints: mintsList }));
    console.log("✓ public/data/mints.json");
  }

  // sameSeries по сериям — из уже загруженных rows, без доп. SQL
  const bySeries = new Map();
  for (const r of rowsToExport) {
    const sn = r.series && String(r.series).trim();
    if (!sn) continue;
    if (!bySeries.has(sn)) bySeries.set(sn, []);
    bySeries.get(sn).push(r);
  }

  let state = { hashes: {} };
  if (incremental && fs.existsSync(STATE_FILE)) {
    try {
      state = JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
    } catch {
      state = { hashes: {} };
    }
  }

  const currentIds = new Set(rowsToExport.map((r) => String(r.id)));
  for (const id of Object.keys(state.hashes || {})) {
    if (!currentIds.has(id)) {
      const p = path.join(COINS_DIR, id + ".json");
      if (fs.existsSync(p)) {
        fs.unlinkSync(p);
        console.log("  удалён:", id);
      }
      delete state.hashes[id];
    }
  }

  const total = rowsToExport.length;
  let done = 0;
  let written = 0;
  for (const r of rowsToExport) {
    const firstImageSide = getFirstImageSide(r.mint);
    const imageUrls = r.image_urls;
    const catalogNumber = r.catalog_number;
    const imageObverse = r.image_obverse;
    const imageReverse = r.image_reverse;
    const imageBox = r.image_box;
    const imageCertificate = r.image_certificate;
    const isThreeCoinSet = (r.title || "").includes("Three Coin Set") || (r.title || "").includes("3 Coin Set");
    const dropWrong = (u) => u && !isThreeCoinSet && String(u).includes(WRONG_3_COIN_SET_PATH) ? null : u;
    const obverse = dropWrong(obverseUrl(imageObverse));
    const reverse = dropWrong(reverseUrl(imageReverse));
    const firstImage = firstImageSide === "reverse" ? (reverse ?? obverse ?? "") : (obverse ?? reverse ?? "");
    const imageUrlsOut = [];
    const imageUrlRoles = [];
    const pushIfNew = (url, role) => {
      if (!url || imageUrlsOut.includes(url)) return;
      imageUrlsOut.push(url);
      imageUrlRoles.push(role);
    };
    if (firstImageSide === "reverse") {
      if (reverse) pushIfNew(reverse, "reverse");
      if (obverse) pushIfNew(obverse, "obverse");
    } else {
      if (obverse) pushIfNew(obverse, "obverse");
      if (reverse) pushIfNew(reverse, "reverse");
    }
    if (imageBox?.trim()) pushIfNew(imageBox.trim(), "box");
    if (imageCertificate?.trim()) pushIfNew(imageCertificate.trim(), "certificate");
    if (imageUrlsOut.length === 0 && Array.isArray(imageUrls) && imageUrls.length > 0) {
      const filtered = isThreeCoinSet ? imageUrls : imageUrls.filter((u) => !String(u).includes(WRONG_3_COIN_SET_PATH));
      if (filtered.length > 0) imageUrlsOut.push(...filtered);
    }
    const releaseDate = r.release_date;
    const titleStr = [r.title, r.title_en].filter(Boolean).join(" ");
    const releaseYear = releaseDate ? (() => {
      const y = new Date(releaseDate).getFullYear();
      return typeof y === "number" && !Number.isNaN(y) && y >= 1900 && y <= 2100 ? y : null;
    })() : null;
    let yearRaw =
      yearFromCatalogSuffix(r.catalog_suffix) ??
      releaseYear ??
      yearFromTitle(titleStr || r.title || r.title_en) ??
      yearFromTitle(r.title) ??
      yearFromTitle(r.title_en) ??
      0;
    let year = Number(yearRaw) || 0;
    if (year === 0) year = yearFromTitle(r.title) ?? yearFromTitle(r.title_en) ?? 0;

    const { code: metalCode, color: metalColor } = getMetalCodeAndColor(r.metal);
    const metalCodes = getMetalCodes(r.metal);
    const coin = {
      id: String(r.id),
      title: r.title,
      seriesName: r.series ?? undefined,
      imageUrl: firstImage || PLACEHOLDER,
      imageUrls: imageUrlsOut.length > 0 ? imageUrlsOut : undefined,
      imageUrlRoles: imageUrlRoles.length > 0 ? imageUrlRoles : undefined,
      inCollection: false,
      mintName: r.mint ?? "—",
      mintShort: r.mint_short ?? undefined,
      mintCountry: r.country ?? "Россия",
      year,
      faceValue: (stripCountryFromFaceValue(r.face_value) || r.face_value) ?? "—",
      metal: metalOnly(r.metal),
      metalCode: metalCode ?? undefined,
      metalColor: metalColor ?? undefined,
      metalCodes: metalCodes.length > 0 ? metalCodes : undefined,
      mintage: r.mintage ?? undefined,
      mintageDisplay: r.mintage_display ?? undefined,
      weightG: formatWeightG(r.weight_g) ?? (r.weight_g != null && r.weight_g !== "" ? String(r.weight_g).trim() : undefined),
      weightOz: r.weight_oz != null && r.weight_oz !== "" ? String(r.weight_oz).trim() : undefined,
      purity: r.metal_fineness ?? undefined,
      quality: r.quality ?? undefined,
      diameterMm: formatSpecNum(r.diameter_mm) ?? r.diameter_mm ?? undefined,
      thicknessMm: formatSpecNum(r.thickness_mm) ?? r.thickness_mm ?? undefined,
      lengthMm: formatSpecNum(r.length_mm) ?? r.length_mm ?? undefined,
      widthMm: formatSpecNum(r.width_mm) ?? r.width_mm ?? undefined,
      catalogSuffix: r.catalog_suffix ?? undefined,
      rectangular: isRectangularCoin(r.catalog_number, rectangularBases, rectangularIds, r.id, r.length_mm, r.width_mm),
      mintLogoUrl: r.mint && mintLogoMap.get(String(r.mint).trim()) ? mintLogoMap.get(String(r.mint).trim()) : undefined,
      priceDisplay: (r.price_display && String(r.price_display).trim()) || undefined,
    };

    const seriesName = r.series;
    let sameSeries = [];
    if (seriesName) {
      const sameRows = (bySeries.get(seriesName) || []).filter((s) => s.id !== r.id).slice(0, 12);
      sameSeries = sameRows.filter(hasImage).slice(0, 6).map((s) => {
        const rev = reverseUrl(s.image_reverse);
        const obv = obverseUrl(s.image_obverse);
        const si = firstImageSide === "reverse" ? (rev ?? obv) : (obv ?? rev);
        const si2 = si ?? firstImageUrl(s.image_urls, null, s.image_obverse) ?? "";
        const { code: metalCode, color: metalColor } = getMetalCodeAndColor(s.metal);
        const metalCodes = getMetalCodes(s.metal);
        const metalName = metalOnly(s.metal);
        const weightG = formatWeightG(s.weight_g) ?? (s.weight_g != null && s.weight_g !== "" ? String(s.weight_g).trim() : undefined);
        return {
          id: String(s.id),
          title: s.title,
          seriesName: s.series ?? undefined,
          faceValue: (stripCountryFromFaceValue(s.face_value) || s.face_value) ?? "—",
          imageUrl: si2 || PLACEHOLDER,
          metalCode: metalCode ?? undefined,
          metalColor: metalColor ?? undefined,
          metalCodes: metalCodes.length > 0 ? metalCodes : undefined,
          metalName: metalName && metalName !== "—" ? metalName : undefined,
          weightG,
          rectangular: isRectangularCoin(s.catalog_number, rectangularBases, rectangularIds, s.id, s.length_mm, s.width_mm),
        };
      });
    }

    const out = { coin, sameSeries };
    const json = JSON.stringify(out);
    const hash = crypto.createHash("sha256").update(json).digest("hex");
    state.hashes = state.hashes || {};
    if (incremental && state.hashes[String(r.id)] === hash) {
      done++;
      continue;
    }
    fs.writeFileSync(
      path.join(COINS_DIR, `${r.id}.json`),
      json
    );
    state.hashes[String(r.id)] = hash;
    written++;
    done++;
    if (done % 500 === 0) console.log("  coins/", done, "/", total);
  }
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 0));
  if (incremental) {
    console.log("✓ public/data/coins/*.json — записано", written, "из", total);
  } else {
    console.log("✓ public/data/coins/*.json —", rowsToExport.length, "монет");
  }

  await conn.end();
  console.log("Готово. Дальше: npm run build → залить out на сервер.");
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
