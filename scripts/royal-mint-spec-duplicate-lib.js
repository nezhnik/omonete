/**
 * Сравнение спарсенной монеты Royal Mint с записями в БД по жёстким спекам:
 * год + вес + металл + тираж — все четыре должны быть известны с обеих сторон и совпасть.
 * Название отдельно: при совпадении спек — помечаем «сравнить названия», не отсекаем автоматически.
 */
const fs = require("fs");
const path = require("path");

const REVIEW_LOG = path.join(__dirname, "..", "data", "royal-mint-spec-collision-review.jsonl");

/** Как в import-royal-mint-to-db.js — только UK RM. */
const ROYAL_SQL_FILTER = `(
  catalog_number LIKE 'GB-ROYAL-%'
  OR (
    source_url LIKE '%royalmint.com%'
    AND (mint LIKE '%Royal Mint%' OR mint_short LIKE '%Royal Mint%')
  )
)`;

function canonicalRoyalMintProductUrl(url) {
  if (url == null || typeof url !== "string") return null;
  const s = url.trim();
  if (!s) return null;
  try {
    const u = new URL(s);
    if (!/royalmint\.com/i.test(u.hostname)) return null;
    u.hash = "";
    u.search = "";
    const p = u.pathname.replace(/\/+$/, "") || "";
    return `${u.origin}${p}`.replace(/\/+$/, "");
  } catch {
    const noQuery = s.split("#")[0].split("?")[0].replace(/\/+$/, "");
    return /royalmint\.com/i.test(noQuery) ? noQuery : null;
  }
}

function normTitle(s) {
  return String(s || "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function yearFromCoinLike(row) {
  if (row.release_date) {
    const d = new Date(row.release_date);
    const y = d.getFullYear();
    if (!Number.isNaN(y) && y >= 1800 && y <= 2100) return y;
  }
  const t = `${row.title || ""} ${row.title_en || ""}`;
  const m = t.match(/\b(19|20)\d{2}\b/);
  return m ? parseInt(m[0], 10) : null;
}

function parseFloatWeight(v) {
  if (v == null || v === "") return null;
  const n = parseFloat(String(v).replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

/** Из блока спек RM: «0.80 g», «31.21 g». */
function parseWeightGFromSpecs(specs) {
  if (!specs || !specs.Weight) return null;
  const m = String(specs.Weight).match(/(\d+[.,]?\d*)/);
  return m ? parseFloat(m[1].replace(",", ".")) : null;
}

/** Тираж из типичных полей спецификации. */
function parseMintageFromSpecs(specs) {
  if (!specs || typeof specs !== "object") return { mintage: null, mintage_display: null };
  const keys = ["Maximum Coin Mintage", "Maximum Mintage", "Limited Edition Presentation"];
  for (const k of keys) {
    const v = specs[k];
    if (v == null || String(v).trim() === "") continue;
    const raw = String(v).trim();
    const digits = raw.replace(/[^\d]/g, "");
    if (digits.length >= 2) {
      const n = parseInt(digits.slice(0, 12), 10);
      if (Number.isFinite(n) && n > 0) return { mintage: n, mintage_display: raw };
    }
  }
  return { mintage: null, mintage_display: null };
}

const MAX_MINTAGE_OVERVIEW = 50_000_000;

/**
 * PDP Royal Mint: в div.product-overview (часто p.sub-title или h2.h3) строка вида «Limited / LIMITED EDITION 200».
 * Используется, если в таблице спецификации тиража нет.
 */
function parseMintageFromProductOverview(overviewText) {
  if (!overviewText || typeof overviewText !== "string") return { mintage: null, mintage_display: null };
  const t = overviewText.replace(/\s+/g, " ").trim();
  if (!t) return { mintage: null, mintage_display: null };
  const re = /\bLimited\s+Edition\s+([\d,.\s\u00A0]+)(?=\s|$)/i;
  const m = t.match(re);
  if (!m) return { mintage: null, mintage_display: null };
  const raw = m[0].trim();
  const digits = m[1].replace(/[^\d]/g, "");
  if (digits.length < 1) return { mintage: null, mintage_display: null };
  const n = parseInt(digits.slice(0, 12), 10);
  if (!Number.isFinite(n) || n < 1 || n > MAX_MINTAGE_OVERVIEW) return { mintage: null, mintage_display: null };
  return { mintage: n, mintage_display: raw };
}

/** Сначала «Limited Edition» в PDP (product-overview), иначе таблица спецификаций — на RM в колонках иногда попадают посторонние числа. */
function parseMintageFromSpecsOrOverview(specs, productOverviewText) {
  const fromOverview = parseMintageFromProductOverview(productOverviewText);
  if (fromOverview.mintage != null) return fromOverview;
  return parseMintageFromSpecs(specs);
}

function normMetal(m) {
  const s = String(m || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
  return s === "" ? null : s;
}

function mintageKey(row) {
  if (row.mintage != null && row.mintage !== "" && Number.isFinite(Number(row.mintage))) {
    return "n:" + String(Math.trunc(Number(row.mintage)));
  }
  const disp = String(row.mintage_display || "").replace(/\s/g, "");
  const digits = disp.replace(/[^\d]/g, "");
  if (digits.length >= 2) return "d:" + digits;
  return null;
}

/**
 * Профиль для сравнения: подставляем вес/тираж из specs, если в coin пусто.
 */
function buildMatchProfile(coin, specs = {}) {
  let weightG = parseFloatWeight(coin.weight_g);
  if (weightG == null) weightG = parseWeightGFromSpecs(specs);

  let mintage = coin.mintage;
  let mintage_display = coin.mintage_display;
  if (mintage == null || mintage === "") {
    const p = parseMintageFromSpecs(specs);
    mintage = p.mintage;
    mintage_display = p.mintage_display ?? mintage_display;
  }

  const row = {
    title: coin.title,
    title_en: coin.title_en,
    release_date: coin.release_date,
    weight_g: weightG,
    metal: coin.metal,
    mintage,
    mintage_display,
  };

  return {
    year: yearFromCoinLike(row),
    weightG,
    metalNorm: normMetal(coin.metal),
    mintageKey: mintageKey({ mintage, mintage_display }),
    titleNorm: normTitle(coin.title_ru || coin.title),
    sourceCanon: canonicalRoyalMintProductUrl(coin.source_url),
  };
}

function strictSpecMatch(profile, dbRow) {
  const ey = yearFromCoinLike(dbRow);
  if (profile.year == null || ey == null || profile.year !== ey) return false;

  const em = normMetal(dbRow.metal);
  if (!profile.metalNorm || !em || profile.metalNorm !== em) return false;

  const ew = parseFloatWeight(dbRow.weight_g);
  if (profile.weightG == null || ew == null || Math.abs(profile.weightG - ew) > 0.02) return false;

  const ek = mintageKey(dbRow);
  if (profile.mintageKey == null || ek == null || profile.mintageKey !== ek) return false;

  return true;
}

async function loadRoyalMintRows(conn) {
  let hasTitleEn = false;
  try {
    const [cols] = await conn.execute(
      "SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'coins' AND COLUMN_NAME = 'title_en'"
    );
    hasTitleEn = cols.length > 0;
  } catch {
    /* ignore */
  }

  const sql = hasTitleEn
    ? `SELECT id, title, title_en, release_date, weight_g, mintage, mintage_display, metal, source_url, catalog_number
       FROM coins WHERE ${ROYAL_SQL_FILTER}`
    : `SELECT id, title, release_date, weight_g, mintage, mintage_display, metal, source_url, catalog_number
       FROM coins WHERE ${ROYAL_SQL_FILTER}`;

  const [rows] = await conn.execute(sql);
  return { rows, hasTitleEn };
}

/**
 * Строки БД с теми же четырьмя спеками, но другим каноническим PDP (не та же страница).
 */
function findSpecCollisions(profile, dbRows) {
  const out = [];
  for (const r of dbRows) {
    if (!strictSpecMatch(profile, r)) continue;
    const their = canonicalRoyalMintProductUrl(r.source_url);
    if (profile.sourceCanon && their && profile.sourceCanon === their) continue;
    out.push(r);
  }
  return out;
}

function appendReviewLog(entry) {
  try {
    fs.mkdirSync(path.dirname(REVIEW_LOG), { recursive: true });
    fs.appendFileSync(REVIEW_LOG, JSON.stringify(entry) + "\n", "utf8");
  } catch (e) {
    console.warn("[royal-mint-spec-dup] не удалось записать лог:", e.message);
  }
}

/**
 * @param {import('mysql2/promise').Connection} conn
 * @param {object} coin — объект .coin из JSON
 * @param {object} specs — raw.specs
 * @param {{ stage: string }} opts
 * @returns {{ duplicate_review: object|null, collisions: object[] }}
 */
async function checkRoyalMintSpecCollisions(conn, coin, specs, opts = {}) {
  const stage = opts.stage || "fetch";
  const profile = buildMatchProfile(coin, specs || {});

  const { rows } = await loadRoyalMintRows(conn);
  const collisions = findSpecCollisions(profile, rows);

  if (collisions.length === 0) {
    return { duplicate_review: null, collisions: [] };
  }

  const titleMatches = collisions.filter((r) => normTitle(r.title) === profile.titleNorm);
  const hint =
    titleMatches.length > 0
      ? "strict_spec_match_same_normalized_title"
      : "strict_spec_match_title_differs_compare_manually";

  const entry = {
    ts: new Date().toISOString(),
    stage,
    hint,
    new_coin: {
      title: coin.title,
      source_url: coin.source_url,
      catalog_number: coin.catalog_number,
      year: profile.year,
      weight_g: profile.weightG,
      metal: coin.metal,
      mintageKey: profile.mintageKey,
    },
    existing: collisions.map((r) => ({
      id: r.id,
      title: r.title,
      source_url: r.source_url,
      catalog_number: r.catalog_number,
    })),
  };
  appendReviewLog(entry);

  const duplicate_review = {
    checked_at: entry.ts,
    stage,
    hint,
    strict_four_way_match_count: collisions.length,
    same_normalized_title_count: titleMatches.length,
    matches: entry.existing,
    review_log: "data/royal-mint-spec-collision-review.jsonl",
    note:
      "Спеки (год+вес+металл+тираж) совпали с уже существующими строками в БД; монета всё равно сохранена. Сверь названия и URL — при необходимости удали лишнюю запись после импорта.",
  };

  return { duplicate_review, collisions };
}

module.exports = {
  REVIEW_LOG,
  canonicalRoyalMintProductUrl,
  buildMatchProfile,
  strictSpecMatch,
  findSpecCollisions,
  loadRoyalMintRows,
  parseMintageFromSpecs,
  parseMintageFromProductOverview,
  parseMintageFromSpecsOrOverview,
  parseWeightGFromSpecs,
  appendReviewLog,
  checkRoyalMintSpecCollisions,
};
