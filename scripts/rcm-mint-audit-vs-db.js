/**
 * Сравнение карточек mint.ca с монетами в MySQL:
 *   1) source_url (канонический mint.ca),
 *   2) точное совпадение нормализованного title,
 *   3) нечёткое title (порог по умолчанию 0.93) + согласованность года/веса, если они есть у обеих сторон.
 * Новые URL (нет в БД) — строка с kind: "new_on_site".
 * Расхождения полей — kind: "diff", список полей в diffs[].
 * Если два кандидата почти одинаково подходят — kind: "fuzzy_ambiguous" (ручной разбор).
 * Совпадение — kind: "ok" (по умолчанию не пишем в jsonl, только --verbose-all).
 *
 * Требует: .env с DATABASE_URL, Playwright.
 *
 * Запуск:
 *   node scripts/rcm-mint-audit-vs-db.js
 *   node scripts/rcm-mint-audit-vs-db.js --limit=20
 *   node scripts/rcm-mint-audit-vs-db.js --match-similarity=0.93   (по умолчанию; off / 0 — только URL + точный title)
 *   node scripts/rcm-mint-audit-vs-db.js --fuzzy-ignore-weight     (не требовать близости веса при fuzzy)
 *   node scripts/rcm-mint-audit-vs-db.js --rcm-candidates-only    (искать пары только среди строк mint.ca / RCM в БД)
 *   node scripts/rcm-mint-audit-vs-db.js --verbose-all
 *   node scripts/rcm-mint-audit-vs-db.js --urls-file=data/rcm-mint-listing-urls.txt
 *
 * Выход:
 *   data/rcm-mint-audit-diff.jsonl  (UTF-8, по одной JSON-строке на запись)
 */
require("dotenv").config({ path: ".env" });
const fs = require("fs");
const path = require("path");
const mysql = require("mysql2/promise");
const {
  canonicalMintCaProductUrl,
  normalizeTitleForMatch,
  titleSimilarity01,
} = require("./rcm-mint-lib.js");

const DATA_DIR = path.join(__dirname, "..", "data");
const DEFAULT_URLS_FILE = path.join(DATA_DIR, "rcm-mint-listing-urls.txt");
const OUT_JSONL = path.join(DATA_DIR, "rcm-mint-audit-diff.jsonl");

function getDbConfig() {
  const url = process.env.DATABASE_URL;
  const m = url && url.match(/mysql:\/\/([^:]+):([^@]+)@([^:]+):(\d+)\/(.+)/);
  if (!m) throw new Error("Нужен DATABASE_URL в .env");
  const [, user, password, host, port, database] = m;
  return { host, port: Number(port), user, password, database, connectTimeout: 20000 };
}

function parseNumArg(name, def) {
  const a = process.argv.find((x) => x.startsWith(`${name}=`));
  if (!a) return def;
  const n = parseInt(a.split("=")[1], 10);
  return Number.isFinite(n) ? n : def;
}

/** Порог нечёткого совпадения названия (0 или off — отключить шаг fuzzy). */
function parseSimilarityArg(name, def) {
  const a = process.argv.find((x) => x.startsWith(`${name}=`));
  if (!a) return def;
  const raw = a.split("=").slice(1).join("=").trim().toLowerCase();
  if (raw === "off" || raw === "false" || raw === "no") return 0;
  const n = parseFloat(raw);
  if (!Number.isFinite(n)) return def;
  if (n <= 0) return 0;
  if (n > 1) return def;
  return n;
}

function pdpExtractScript() {
  return () => {
    const h1 = document.querySelector("h1");
    const title = h1 ? h1.innerText.trim() : null;
    const body = document.body?.innerText || "";
    const i = body.indexOf("Specifications");
    const specSlice = i < 0 ? body.slice(0, 12000) : body.slice(i, Math.min(body.length, i + 6000));

    const pick = (re) => {
      const m = specSlice.match(re);
      return m ? m[1].trim() : null;
    };

    let year = null;
    const ym = window.location.pathname.match(/\/coins\/(20\d{2})\//);
    if (ym) year = parseInt(ym[1], 10);

    return {
      title,
      sku: pick(/Product Number\s*([^\n\r]+)/i),
      weight_g_raw: pick(/Weight\s+([\d.,]+)\s*g/i),
      mintage_raw: pick(/Mintage\s*([\d,\s]+)/i),
      composition: pick(/Composition\s*([^\n\r]+)/i),
      diameter_mm_raw: pick(/Diameter\s+([\d.,]+)\s*mm/i),
      face_value: pick(/Face Value\s*([^\n\r]+)/i),
      finish: pick(/Finish\s*([^\n\r]+)/i),
      year_from_url: year,
    };
  };
}

function parseWeightG(raw) {
  if (raw == null) return null;
  const n = parseFloat(String(raw).replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

function parseMintage(raw) {
  if (raw == null) return null;
  const t = String(raw).trim().toLowerCase();
  if (/unlimited|n\/a|none/i.test(t)) return null;
  const digits = t.replace(/[^\d]/g, "");
  if (!digits) return null;
  const n = parseInt(digits, 10);
  return Number.isFinite(n) ? n : null;
}

function parseDiameter(raw) {
  if (raw == null) return null;
  const n = parseFloat(String(raw).replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

function metalFamilyFromComposition(comp) {
  if (!comp) return null;
  const s = comp.toLowerCase();
  if (s.includes("silver")) return "silver";
  if (s.includes("gold")) return "gold";
  if (s.includes("steel") || s.includes("cupronickel") || s.includes("nickel")) return "base";
  if (s.includes("platinum")) return "platinum";
  return "other";
}

function metalFamilyFromDb(metal) {
  if (!metal) return null;
  const s = String(metal).toLowerCase();
  if (/серебро|silver|ag/i.test(s)) return "silver";
  if (/золото|gold|au/i.test(s)) return "gold";
  if (/сталь|steel|медь|nickel|cupro|base/i.test(s)) return "base";
  if (/платин|platinum|pt/i.test(s)) return "platinum";
  return "other";
}

function yearFromDbRow(row) {
  if (row.release_date) {
    const d = row.release_date;
    if (d instanceof Date) return d.getFullYear();
    const m = String(d).match(/(20\d{2})/);
    if (m) return parseInt(m[1], 10);
  }
  return null;
}

function closeEnoughG(a, b, tol = 0.2) {
  if (a == null && b == null) return true;
  if (a == null || b == null) return false;
  return Math.abs(Number(a) - Number(b)) <= tol;
}

function closeEnoughMintage(a, b) {
  if (a == null && b == null) return true;
  if (a == null || b == null) return false;
  return Math.abs(Number(a) - Number(b)) <= Math.max(2, Number(b) * 0.002);
}

async function loadAuditCandidates(conn, rcmOnly) {
  const base = `SELECT id, title, title_en, source_url, catalog_number, catalog_suffix,
            weight_g, weight_oz, mintage, metal, metal_fineness, quality,
            release_date, diameter_mm, thickness_mm, face_value
     FROM coins`;
  const filter = rcmOnly
    ? ` WHERE (source_url IS NOT NULL AND source_url LIKE '%mint.ca%')
        OR mint LIKE '%Royal Canadian Mint%'
        OR mint_short IN ('RCM', 'Royal Canadian Mint')`
    : "";
  const [rows] = await conn.execute(base + filter);
  return rows;
}

function normSku(s) {
  if (s == null) return null;
  const t = String(s).trim();
  return t || null;
}

/** Product Number на сайте → catalog_number или catalog_suffix в БД (если заведены). */
function matchRowBySku(rows, sku) {
  const s = normSku(sku);
  if (!s) return null;
  for (const r of rows) {
    if (normSku(r.catalog_number) === s || normSku(r.catalog_suffix) === s) {
      return { row: r, how: "catalog_sku" };
    }
  }
  return null;
}

function matchRowByUrl(rows, canonicalUrl) {
  for (const r of rows) {
    const c = canonicalMintCaProductUrl(r.source_url || "");
    if (c && c === canonicalUrl) return { row: r, how: "source_url" };
  }
  return null;
}

function matchRowByTitle(rows, siteTitle) {
  const nt = normalizeTitleForMatch(siteTitle);
  if (!nt) return null;
  for (const r of rows) {
    if (normalizeTitleForMatch(r.title_en || "") === nt) return { row: r, how: "title_en" };
    if (normalizeTitleForMatch(r.title || "") === nt) return { row: r, how: "title" };
  }
  return null;
}

/** Для mint.ca заголовок на англ.: приоритет сравнения с title_en (тихий каталог), иначе с title. */
function titleSimilaritySiteToDbRow(siteTitle, r) {
  const en = String(r.title_en || "").trim();
  if (en) return titleSimilarity01(siteTitle, en);
  return titleSimilarity01(siteTitle, r.title || "");
}

/**
 * Нечёткое совпадение: similarity ≥ minSim. Строка на сайте mint.ca — англ.;
 * если в БД заполнен title_en, считаем сходство только с ним, иначе с title.
 * Год и вес сверяются, только если заданы у обеих сторон.
 */
function matchRowByFuzzyTitle(
  rows,
  siteTitle,
  siteYear,
  siteWeightG,
  minSim,
  closeEnoughGFn,
  fuzzyIgnoreWeight
) {
  if (!minSim || minSim <= 0 || minSim > 1) return null;
  const scored = [];
  for (const r of rows) {
    const sim = titleSimilaritySiteToDbRow(siteTitle, r);
    if (sim < minSim) continue;
    const dbY = yearFromDbRow(r);
    if (siteYear != null && dbY != null && siteYear !== dbY) continue;
    if (
      !fuzzyIgnoreWeight &&
      siteWeightG != null &&
      r.weight_g != null &&
      !closeEnoughGFn(r.weight_g, siteWeightG)
    ) {
      continue;
    }
    scored.push({ row: r, sim });
  }
  if (scored.length === 0) return null;
  scored.sort((a, b) => b.sim - a.sim);
  const top = scored[0].sim;
  const second = scored.length > 1 ? scored[1].sim : -1;
  const gap = top - second;
  if (second >= minSim && gap < 0.012) {
    return {
      ambiguous: true,
      candidates: scored.slice(0, Math.min(5, scored.length)).map((s) => ({
        id: s.row.id,
        title: s.row.title,
        title_en: s.row.title_en || null,
        sim: Math.round(s.sim * 1000) / 1000,
      })),
    };
  }
  const r0 = scored[0].row;
  const viaEn = String(r0.title_en || "").trim().length > 0;
  return {
    row: r0,
    how: `${viaEn ? "fuzzy_title_en" : "fuzzy_title"}(${scored[0].sim.toFixed(3)})`,
    sim: scored[0].sim,
  };
}

async function main() {
  const limit = parseNumArg("--limit", 0);
  const verboseAll = process.argv.includes("--verbose-all");
  const fuzzyMinSim = parseSimilarityArg("--match-similarity", 0.93);
  const fuzzyIgnoreWeight = process.argv.includes("--fuzzy-ignore-weight");
  const rcmCandidatesOnly = process.argv.includes("--rcm-candidates-only");
  const urlsFileArg = process.argv.find((a) => a.startsWith("--urls-file="));
  const urlsPath = urlsFileArg ? urlsFileArg.split("=").slice(1).join("=").trim() : DEFAULT_URLS_FILE;

  if (!fs.existsSync(urlsPath)) {
    console.error("Нет файла со списком URL. Сначала: node scripts/fetch-rcm-mint-listing.js");
    console.error("Ожидалось:", urlsPath);
    process.exit(1);
  }

  const lines = fs
    .readFileSync(urlsPath, "utf8")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => canonicalMintCaProductUrl(l))
    .filter(Boolean);

  const toVisit = limit > 0 ? lines.slice(0, limit) : lines;
  console.log("URL к обходу:", toVisit.length);

  const conn = await mysql.createConnection(getDbConfig());
  const candidates = await loadAuditCandidates(conn, rcmCandidatesOnly);
  await conn.end();
  console.log(
    "Строк в БД для сопоставления:",
    candidates.length,
    rcmCandidatesOnly ? "(только mint.ca / RCM)" : "(все монеты)"
  );
  console.log(
    "Нечёткое сопоставление:",
    fuzzyMinSim > 0
      ? `вкл, порог title ≥ ${fuzzyMinSim}, год/вес при двух значениях; вес ${fuzzyIgnoreWeight ? "игнор" : "учитывается"}`
      : "выкл (только URL и точное название)"
  );

  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  const out = fs.createWriteStream(OUT_JSONL, { flags: "w" });

  const { chromium } = require("playwright");
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    locale: "en-CA",
  });
  const page = await context.newPage();

  let nNew = 0;
  let nDiff = 0;
  let nOk = 0;
  let nFuzzyAmbiguous = 0;

  for (let idx = 0; idx < toVisit.length; idx++) {
    const url = toVisit[idx];
    process.stdout.write(`\r[${idx + 1}/${toVisit.length}] ${url.slice(-55)}   `);
    try {
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 });
      await page.waitForTimeout(400);
      const raw = await page.evaluate(pdpExtractScript());
      const site = {
        url,
        title: raw.title,
        weight_g: parseWeightG(raw.weight_g_raw),
        mintage: parseMintage(raw.mintage_raw),
        composition: raw.composition,
        diameter_mm: parseDiameter(raw.diameter_mm_raw),
        face_value: raw.face_value,
        finish: raw.finish,
        sku: raw.sku,
        year: raw.year_from_url,
      };

      const canon = canonicalMintCaProductUrl(url);
      let match = matchRowByUrl(candidates, canon);
      if (!match && site.sku) match = matchRowBySku(candidates, site.sku);
      if (!match && site.title) match = matchRowByTitle(candidates, site.title);
      if (!match && site.title && fuzzyMinSim > 0) {
        const fuzzy = matchRowByFuzzyTitle(
          candidates,
          site.title,
          site.year,
          site.weight_g,
          fuzzyMinSim,
          closeEnoughG,
          fuzzyIgnoreWeight
        );
        if (fuzzy && fuzzy.ambiguous) {
          nFuzzyAmbiguous++;
          out.write(
            JSON.stringify({
              kind: "fuzzy_ambiguous",
              url,
              title: site.title,
              message: "Два и более кандидата с похожим названием; уточните вручную",
              candidates: fuzzy.candidates,
              parsed: site,
            }) + "\n"
          );
          continue;
        }
        if (fuzzy && fuzzy.row) match = { row: fuzzy.row, how: fuzzy.how };
      }

      if (!match) {
        nNew++;
        out.write(
          JSON.stringify({
            kind: "new_on_site",
            url,
            title: site.title,
            parsed: site,
          }) + "\n"
        );
        continue;
      }

      const r = match.row;
      const diffs = [];
      const dbY = yearFromDbRow(r);
      if (site.year != null && dbY != null && site.year !== dbY) {
        diffs.push({ field: "year", db: dbY, site: site.year });
      }
      if (!closeEnoughG(r.weight_g, site.weight_g)) {
        diffs.push({ field: "weight_g", db: r.weight_g, site: site.weight_g });
      }
      if (!closeEnoughMintage(r.mintage, site.mintage)) {
        diffs.push({ field: "mintage", db: r.mintage, site: site.mintage });
      }
      const f1 = metalFamilyFromComposition(site.composition);
      const f2 = metalFamilyFromDb(r.metal);
      if (f1 && f2 && f1 !== f2 && f1 !== "other" && f2 !== "other") {
        diffs.push({ field: "metal_family", db: r.metal, site: site.composition });
      }
      if (site.finish && r.quality && String(r.quality).toLowerCase() !== String(site.finish).toLowerCase()) {
        if (!String(r.quality).toLowerCase().includes(String(site.finish).toLowerCase().slice(0, 4))) {
          diffs.push({ field: "quality_finish", db: r.quality, site: site.finish });
        }
      }
      if (!closeEnoughG(r.diameter_mm, site.diameter_mm, 0.5)) {
        diffs.push({ field: "diameter_mm", db: r.diameter_mm, site: site.diameter_mm });
      }
      if (site.face_value && r.face_value) {
        const a = String(r.face_value).replace(/\s+/g, " ").trim();
        const b = String(site.face_value).replace(/\s+/g, " ").trim();
        if (a.toLowerCase() !== b.toLowerCase()) {
          diffs.push({ field: "face_value", db: r.face_value, site: site.face_value });
        }
      }

      if (diffs.length) {
        nDiff++;
        out.write(
          JSON.stringify({
            kind: "diff",
            url,
            title: site.title,
            db_id: r.id,
            match_how: match.how,
            diffs,
            db_title: r.title,
          }) + "\n"
        );
      } else {
        nOk++;
        if (verboseAll) {
          out.write(
            JSON.stringify({
              kind: "ok",
              url,
              db_id: r.id,
              match_how: match.how,
            }) + "\n"
          );
        }
      }
    } catch (e) {
      out.write(
        JSON.stringify({
          kind: "error",
          url,
          message: String(e.message || e),
        }) + "\n"
      );
    }
  }

  await browser.close();
  out.end();

  console.log("\n\nГотово.");
  console.log("  новых на сайте (нет пары в БД):", nNew);
  console.log("  с расхождениями:", nDiff);
  console.log("  неоднозначное fuzzy (ручной разбор):", nFuzzyAmbiguous);
  console.log("  совпало:", nOk);
  console.log("Файл:", OUT_JSONL);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
