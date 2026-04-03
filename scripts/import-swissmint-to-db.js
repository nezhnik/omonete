/**
 * Импорт Swissmint из data/swissmint-*.json.
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

function parseWeight(specs, title) {
  const raw = String(specs.Weight || specs["Fine weight"] || specs["Net weight"] || title || "").trim();
  const n = parseNumber(raw);
  if (n == null) return { weight_g: null, weight_oz: null };
  if (/oz|ounce|troy/i.test(raw)) return { weight_g: Math.round(n * 31.1034768 * 100) / 100, weight_oz: n };
  if (/kg|kilo/i.test(raw)) {
    const g = Math.round(n * 1000 * 100) / 100;
    return { weight_g: g, weight_oz: Math.round((g / 31.1034768) * 10000) / 10000 };
  }
  let g = Math.round(n * 100) / 100;
  /** «32258» без точки при золоте ~32.258 g */
  if (g >= 1000 && g <= 99999 && /gold|золот|au\b/i.test(`${specs.Alloy || ""} ${title}`)) {
    const scaled = g / 1000;
    if (scaled >= 0.5 && scaled <= 500) g = Math.round(scaled * 1000) / 1000;
  }
  return { weight_g: g, weight_oz: Math.round((g / 31.1034768) * 10000) / 10000 };
}

function parseMetal(specs, title) {
  const src = `${Object.values(specs || {}).join(" ")} ${title || ""}`.toLowerCase();
  if (/silver|ag\b/.test(src)) return "Серебро";
  if (/gold|au\b/.test(src)) return "Золото";
  if (/copper|cu\b/.test(src)) return "Медь";
  if (/bimetal/i.test(src)) return "Биметалл";
  return null;
}

function parseMintage(specs) {
  const specBlob = Object.values(specs || {})
    .map((v) => String(v || "").trim())
    .filter(Boolean)
    .join("\n");

  const parseSwissQty = (chunk) => {
    const normalized = String(chunk || "")
      .replace(/[\s''’']/g, "")
      .replace(/\./g, "")
      .replace(/,/g, "");
    const n = Number(normalized);
    return Number.isFinite(n) && n > 0 && n < 1e9 ? n : null;
  };

  /** Общие шаблоны Swissmint (shop + sondermuenze) по полному тексту specs */
  function tryMintageFromSpecBlob(displayFallback) {
    const disp = displayFallback || specBlob.slice(0, 500);
    const mintageColonUnits = specBlob.match(/\bMintage:\s*([\d\s''’.,]+?)\s*units\b/i);
    if (mintageColonUnits) {
      const n = parseSwissQty(mintageColonUnits[1]);
      if (n != null) return { mintage: n, mintage_display: disp };
    }
    const mintageLabeledUnits = specBlob.match(/\bMintage\s+[^:]+:\s*([\d\s''’.,]+?)\s*units\b/i);
    if (mintageLabeledUnits) {
      const n = parseSwissQty(mintageLabeledUnits[1]);
      if (n != null) return { mintage: n, mintage_display: disp };
    }
    const mintageLabeledPieces = specBlob.match(/\bMintage\s+[^:]+:\s*([\d\s''’.,]+?)\s*pieces\b/i);
    if (mintageLabeledPieces) {
      const n = parseSwissQty(mintageLabeledPieces[1]);
      if (n != null) return { mintage: n, mintage_display: disp };
    }
    const proofCoins = specBlob.match(/\bProof:\s*([\d\s''’.,]+?)\s*coins\b/i);
    if (proofCoins) {
      const n = parseSwissQty(proofCoins[1]);
      if (n != null) return { mintage: n, mintage_display: disp };
    }
    return null;
  }

  const direct = String(specs.Mintage || specs["Maximum mintage"] || "").trim();
  const mintageLike = Object.entries(specs || {}).filter(([k]) => /mintage/i.test(String(k || "")));
  const joined = mintageLike
    .map(([k, v]) => `${k}: ${String(v || "").trim()}`)
    .filter((x) => !/: $/.test(x))
    .join("; ");
  const raw = direct || joined;

  if (raw && /∞|unlimited/i.test(raw)) return { mintage: null, mintage_display: "Не ограничен" };

  if (raw) {
    let firstValue = direct || (mintageLike.length ? String(mintageLike[0][1] || "") : raw);
    /** «5,000 units Price … CHF 719.-» — иначе все цифры склеиваются в 5000719 */
    firstValue = firstValue.split(/\bPrice\b/i)[0].trim();
    const unitsM = firstValue.match(/([\d\s''’\.,]+?)\s*units\b/i);
    if (unitsM) {
      const normalized = unitsM[1].replace(/[\s''’']/g, "").replace(/\./g, "").replace(/,/g, "");
      const n = Number(normalized);
      if (Number.isFinite(n) && n > 0 && n < 1e10)
        return { mintage: n, mintage_display: firstValue || raw };
    }
    const fromBlob = tryMintageFromSpecBlob(firstValue || raw);
    if (fromBlob) return fromBlob;
    const firstNumM = firstValue.match(/\b(\d{1,3}(?:[,\s]\d{3})+|\d{2,7})\b/);
    if (firstNumM) {
      const n = Number(firstNumM[1].replace(/[\s,]/g, ""));
      if (Number.isFinite(n) && n > 0 && n < 1e9) return { mintage: n, mintage_display: firstValue || raw };
    }
    return { mintage: null, mintage_display: raw };
  }

  const fromBlobOnly = tryMintageFromSpecBlob(specBlob ? specBlob.slice(0, 500) : null);
  if (fromBlobOnly) return fromBlobOnly;
  return { mintage: null, mintage_display: null };
}

function parseFaceValue(specs, title) {
  const raw = String(specs.Denomination || specs["Face value"] || "").trim();
  if (raw) return raw;
  const legal = String(specs["Legal face value"] || "").trim();
  if (legal) {
    const mChfPrefix = legal.match(/^CHF\s*(\d+(?:[.,]\d+)?)\b/i);
    if (mChfPrefix) return `${mChfPrefix[1].replace(",", ".")} CHF`;
    const mSwiss = legal.match(/(\d+(?:[.,]\d+)?)\s*Swiss\s+francs/i);
    if (mSwiss) return `${mSwiss[1].replace(",", ".")} CHF`;
  }
  for (const v of Object.values(specs || {})) {
    const s = String(v || "");
    const mFv = s.match(/Face value:\s*(\d+(?:[.,]\d+)?)\s*Swiss francs/i);
    if (mFv) return `${mFv[1].replace(",", ".")} CHF`;
  }
  const m = String(title || "").match(/\b(\d+(?:[.,]\d+)?)\s*[- ]?(franc|chf)\b/i);
  if (!m) return null;
  return `${m[1].replace(",", ".")} CHF`;
}

function parseFineness(specs, title) {
  const alloy = String(specs.Alloy || "").trim();
  /** «Gold 0,900» / «Silver 0,999» — не брать Fineness из title («100 year» давало пробу 1000) */
  const mAlloy = alloy.match(/(\d+[.,]\d{1,3}|\d{3,4})\b/);
  if (mAlloy) {
    const n = Number(mAlloy[1].replace(",", "."));
    if (Number.isFinite(n) && n > 0 && n <= 1.1) return String(Math.round(n * 1000));
    if (Number.isFinite(n) && n >= 800 && n <= 999 && /gold|silver/i.test(alloy)) return String(Math.round(n));
  }
  const raw = String(specs.Fineness || specs.Purity || "").trim();
  if (!raw) return null;
  const m = raw.match(/(\d{2,4}(?:\.\d+)?)/);
  if (!m) return null;
  const n = Number(m[1]);
  if (!Number.isFinite(n) || n <= 1) return null;
  if (n < 10) return String(Math.round(n * 1000));
  if (n <= 100) return String(Math.round(n * 10));
  return String(Math.round(n));
}

async function main() {
  const files = fs
    .readdirSync(DATA_DIR)
    .filter((f) => f.startsWith("swissmint-") && f.endsWith(".json") && !f.includes("listing-products"))
    .map((f) => path.join(DATA_DIR, f))
    .sort();
  if (!files.length) throw new Error("Нет data/swissmint-*.json");
  if (!fs.existsSync(REPORT_DIR)) fs.mkdirSync(REPORT_DIR, { recursive: true });

  const conn = await mysql.createConnection(getConfig());
  const report = { total: files.length, inserted: 0, updated: 0, skipped_duplicate: 0, errors: 0 };

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
      const source = String(c.source_url || "").trim();
      if (!source) continue;
      const specs = c.specs || {};
      const releaseDate = parseYearToDate(title);
      const metal = parseMetal(specs, title);
      const { weight_g, weight_oz } = parseWeight(specs, title);

      const [existsBySource] = await conn.execute("SELECT id FROM coins WHERE source_url = ? LIMIT 1", [source]);
      /** Дубликат по сигнатуре — только при вставке новой строки; иначе блокировался UPDATE по source_url и залипали старые пути к картинкам. */
      if (
        !existsBySource.length &&
        title &&
        releaseDate &&
        metal &&
        weight_g != null
      ) {
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

      const { mintage, mintage_display } = parseMintage(specs);
      const imageUrls = Array.isArray(c.imageUrls) ? c.imageUrls.filter(Boolean) : [];
      const row = {
        title: title || source,
        title_en: title || source,
        series: "Swissmint",
        country: "Швейцария",
        face_value: parseFaceValue(specs, title),
        mint: "Swissmint",
        mint_short: "Swissmint",
        metal,
        metal_fineness: parseFineness(specs, title),
        mintage,
        mintage_display,
        weight_g,
        weight_oz,
        release_date: releaseDate,
        catalog_number: null,
        catalog_suffix: String(c.slug || "").slice(0, 32) || null,
        quality: String(specs.Quality || "").trim() || null,
        diameter_mm: parseNumber(specs.Diameter || null),
        thickness_mm: parseNumber(specs.Thickness || null),
        length_mm: null,
        width_mm: null,
        image_obverse: c.image_obverse || imageUrls[0] || null,
        image_reverse: c.image_reverse || imageUrls[1] || imageUrls[0] || null,
        image_urls: imageUrls.length ? JSON.stringify(imageUrls) : null,
        source_url: source,
      };

      if (existsBySource.length) {
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
  const reportFile = path.join(REPORT_DIR, "swissmint-import-report.json");
  fs.writeFileSync(reportFile, JSON.stringify(report, null, 2), "utf8");
  console.log("\nГотово.");
  console.log(report);
  console.log("Отчет:", reportFile);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

