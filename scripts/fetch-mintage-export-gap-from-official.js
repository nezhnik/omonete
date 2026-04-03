/**
 * Одним прогоном обходит source_url у монет из «export gap» (как mintage-export-gap-research)
 * и пытается снять тираж с официальных страниц.
 *
 * Royal Mint: Playwright + все div.product-overview (в т.ч. класс tw:mb-2 вместо mb-2): p.sub-title, h2.h3, col — «Limited Edition N»,
 *   затем таблица спецификаций, если в overview тиража нет.
 * PAMP (www.pamp.com): Playwright как fetch-pamp-product — GraphQL pageByUrl + DOM; тираж из specs.Mintage и .product-description__text (mintage of N / limited mintage …).
 * Monnaie de Paris: Playwright + сырой HTML + общие regex.
 * Прочие хосты: HTTP GET + эвристики по HTML (без JS).
 * inwestycje.mennica.com.pl: часто 403/Cloudflare без VPN — остаётся простой fetch.
 *
 *   node scripts/fetch-mintage-export-gap-from-official.js              — только отчёт
 *   node scripts/fetch-mintage-export-gap-from-official.js --apply      — + UPDATE MySQL
 *   ... --limit 20   — для теста
 *   ... --mint "Mennica Polska,Monnaie de Paris"  — только строки, у которых mint/mint_short содержит подстроку (через запятую)
 */
require("dotenv").config({ path: ".env" });
const fs = require("fs");
const path = require("path");
const https = require("https");
const http = require("http");
const mysql = require("mysql2/promise");
const {
  coinNeedsMintageResearch,
  extractPampMintagePhraseFromPlainText,
} = require("./parsing-mintage-constants.js");
const {
  parseMintageFromProductOverview,
  parseMintageFromSpecsOrOverview,
} = require("./royal-mint-spec-duplicate-lib.js");
const { attachGqlProductCapture, parsePampProductPageLight } = require("./fetch-pamp-product.js");

const ROOT = path.join(__dirname, "..");
const REPORT_DEFAULT = path.join(ROOT, "reports", "mintage-export-gap-fetch-report.json");
const REPORT_MINT_FILTER = path.join(ROOT, "reports", "mintage-export-gap-fetch-mint-filter.json");
const RM_NO_MINTAGE_CACHE_PATH = path.join(ROOT, "reports", "mintage-export-gap-no-mintage-cache-rm.json");

const EXCLUDED_EXPORT_COIN_IDS = new Set(["5998", "6000", "6012"]);
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
const MINTAGE_NOTE = " (официальный сайт, автосбор export-gap)";
const MAX_MINTAGE = 50_000_000;
// Royal Mint: ускоряем за счет более коротких ожиданий. Точность держим за счет кэша
// (кэшируем "точно нет тиража" только если страница отдала контент overview/specs не пустые).
const DELAY_RM_MS = 250;
const DELAY_FETCH_MS = 250;

const RM_NO_MINTAGE_CACHE_VERSION = 1;
const RM_NO_MINTAGE_CACHE_MAX_AGE_DAYS = 365;

function rmCanonicalSourceUrlForCache(url) {
  try {
    const u = new URL(String(url).trim());
    if (!/royalmint\.com$/i.test(u.hostname)) return String(url).trim();
    u.hash = "";
    u.search = "";
    const p = u.pathname.replace(/\/+$/, "") || "";
    return `${u.origin}${p}`;
  } catch {
    return String(url || "").trim().replace(/\/+$/, "");
  }
}

function loadRmNoMintageCache() {
  try {
    if (!fs.existsSync(RM_NO_MINTAGE_CACHE_PATH)) return { version: RM_NO_MINTAGE_CACHE_VERSION, items: {} };
    const raw = fs.readFileSync(RM_NO_MINTAGE_CACHE_PATH, "utf8");
    const parsed = JSON.parse(raw || "{}");
    if (!parsed || typeof parsed !== "object") return { version: RM_NO_MINTAGE_CACHE_VERSION, items: {} };
    if (parsed.version !== RM_NO_MINTAGE_CACHE_VERSION) return { version: RM_NO_MINTAGE_CACHE_VERSION, items: {} };
    if (!parsed.items || typeof parsed.items !== "object") return { version: RM_NO_MINTAGE_CACHE_VERSION, items: {} };
    return parsed;
  } catch {
    return { version: RM_NO_MINTAGE_CACHE_VERSION, items: {} };
  }
}

function isRmNoMintageCachedForRow(cache, row) {
  const id = String(row.id);
  const item = cache?.items?.[id];
  if (!item) return false;
  const cachedAt = item.cachedAt ? new Date(item.cachedAt).getTime() : 0;
  if (cachedAt && Number.isFinite(cachedAt)) {
    const ageMs = Date.now() - cachedAt;
    const maxAgeMs = RM_NO_MINTAGE_CACHE_MAX_AGE_DAYS * 24 * 60 * 60 * 1000;
    if (ageMs > maxAgeMs) return false;
  }
  const rowCanon = rmCanonicalSourceUrlForCache(row.source_url);
  return item.reason === "no_mintage_on_page" && item.source_url === rowCanon;
}

function getConfig() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL не задан");
  const m = url.match(/mysql:\/\/([^:]+):([^@]+)@([^:]+):(\d+)\/(.+)/);
  if (!m) throw new Error("Неверный формат DATABASE_URL");
  const [, user, password, host, port, database] = m;
  return { host, port: Number(port), user, password, database };
}

function rowKeptInExportCatalog(r) {
  if (EXCLUDED_EXPORT_COIN_IDS.has(String(r.id))) return false;
  const hasNumericMintage = r.mintage != null && Number(r.mintage) !== 0;
  const country = (r.country || "").trim();
  const hasDisplay = r.mintage_display != null && String(r.mintage_display).trim() !== "";
  const isForeignUnlimited = country && !/^Россия/i.test(country) && hasDisplay;
  const isRoyalMintCatalog = /^GB-ROYAL-/i.test(String(r.catalog_number || "").trim());
  const isPampCollectible = /^CH-PAMP-/i.test(String(r.catalog_number || "").trim());
  const isMennicaGoldBar = /^PL-MENNICA-GOLD-BAR-/i.test(String(r.catalog_number || "").trim());
  return (
    hasNumericMintage || isForeignUnlimited || isRoyalMintCatalog || isPampCollectible || isMennicaGoldBar
  );
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function saneMintage(n) {
  if (n == null || !Number.isFinite(n)) return false;
  const x = Math.floor(Number(n));
  return x >= 1 && x <= MAX_MINTAGE;
}

function digitsToInt(s) {
  const d = String(s).replace(/[^\d]/g, "");
  if (d.length < 1) return null;
  const n = parseInt(d.slice(0, 12), 10);
  return saneMintage(n) ? n : null;
}

/** Год в JSON/meta часто матчится как «тираж» (напр. yeardate 2026). */
function looksLikeCatalogYearNotMintage(n, rawSnippet) {
  if (n < 1990 || n > 2035) return false;
  const t = String(rawSnippet || "").replace(/\s/g, "");
  if (!/^\d{1,4}$/.test(t)) return false;
  return true;
}

function extractMintageFromHtml(html) {
  if (!html || typeof html !== "string") return null;
  const patterns = [
    /<th[^>]*>\s*Maximum\s+Coin\s+Mintage\s*<\/th>\s*<td[^>]*>([\s\S]*?)<\/td>/gi,
    /<th[^>]*>\s*Maximum\s+Mintage\s*<\/th>\s*<td[^>]*>([\s\S]*?)<\/td>/gi,
    /<th[^>]*>\s*Mintage\s*<\/th>\s*<td[^>]*>([\s\S]*?)<\/td>/gi,
    /<th[^>]*>\s*Limited\s+Edition\s+Presentation\s*<\/th>\s*<td[^>]*>([\s\S]*?)<\/td>/gi,
    /"maximumMintage"\s*:\s*"?(\d{1,12})"?/i,
    /limited\s+mintage\s+of\s*([\d,\s]+)/i,
    /\bissue\s*limit\s*[:\s]*([\d,\s]+)/i,
    /\bTirage\s*(?:limité)?\s*[:\s]*([\d\s\u00A0]+)/i,
    /\bTirage\s*:\s*([\d\s\u00A0]+)\s*(?:exemplaires)?/i,
    /"tirage"\s*:\s*"?(\d{1,12})"?/i,
    /\bNakład\s*[:\s]*([\d\s.,]+)/i,
    /\bnaklad\s*[:\s]*([\d\s.,]+)/i,
    /\bemisja\s*[:\s]*([\d\s.,]+)\s*(?:szt\.?)?/i,
    /\bmintage\s*[:\s]+([\d\s.,]+)\b/i,
    /"mintage"\s*:\s*"?(\d{1,12})"?/i,
  ];
  for (const re of patterns) {
    re.lastIndex = 0;
    const m = re.exec(html);
    if (m && m[1]) {
      const text = m[1].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
      const n = digitsToInt(text);
      if (n == null) continue;
      if (looksLikeCatalogYearNotMintage(n, text)) continue;
      return { mintage: n, mintage_display: text };
    }
  }
  return null;
}

/** Логика как import-pamp-to-db.js parseMintage (описание уже подмешано в specs при разборе PDP). */
function parsePampMintageFromSpecs(specs, title) {
  const s = specs && typeof specs === "object" ? specs : {};
  const specM = s.Mintage != null ? String(s.Mintage).trim() : "";
  if (specM) {
    const digits = specM.replace(/[^\d]/g, "");
    const n = digits ? Number(digits) : null;
    return { mintage: Number.isFinite(n) && n > 0 ? n : null, mintageDisplay: specM || null };
  }
  const t = String(title || "").trim();
  const phrase = extractPampMintagePhraseFromPlainText(t);
  if (phrase) {
    const display = phrase;
    const digits = display.replace(/[^\d]/g, "");
    const n = digits ? Number(digits) : null;
    return { mintage: Number.isFinite(n) && n > 0 ? n : null, mintageDisplay: display || null };
  }
  return { mintage: null, mintageDisplay: null };
}

function fetchText(url) {
  return new Promise((resolve) => {
    try {
      const u = new URL(url);
      const lib = u.protocol === "https:" ? https : http;
      const req = lib.get(
        url,
        {
          timeout: 25000,
          headers: {
            "User-Agent": UA,
            Accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.8",
            "Accept-Language": "en-GB,en;q=0.9,fr;q=0.8,pl;q=0.7",
          },
        },
        (res) => {
          if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
            res.resume();
            return resolve(fetchText(new URL(res.headers.location, url).toString()));
          }
          if (res.statusCode !== 200) {
            res.resume();
            return resolve(null);
          }
          const chunks = [];
          res.on("data", (c) => chunks.push(c));
          res.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
        }
      );
      req.on("error", () => resolve(null));
      req.on("timeout", () => {
        req.destroy();
        resolve(null);
      });
    } catch {
      resolve(null);
    }
  });
}

async function scrapeRoyalMintSpecsPlaywright(page, url) {
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 });
  await page
    .waitForSelector("div.product-overview, div.mod-section.specification", { timeout: 12000 })
    .catch(() => {});
  await page.waitForTimeout(900);
  const { specs, productOverviewText } = await page.evaluate(() => {
    const out = {};
    function mergeTableRowsIntoSpecs(table) {
      const bodies = table.tBodies && table.tBodies.length ? [...table.tBodies] : null;
      const rows = bodies
        ? bodies.flatMap((tb) => [...tb.querySelectorAll("tr")])
        : [...table.querySelectorAll("tr")].filter((tr) => !tr.closest("thead"));
      rows.forEach((tr) => {
        const cells = [...tr.querySelectorAll("th, td")].map((c) => c.textContent.replace(/\s+/g, " ").trim());
        if (cells.length < 2 || !cells[0]) return;
        const key = cells[0];
        if (/^(specification|value)$/i.test(key)) return;
        out[key] = cells.slice(1).join(" ").trim();
      });
    }
    const specSection = document.querySelector("div.mod-section.specification");
    if (specSection) specSection.querySelectorAll("table").forEach(mergeTableRowsIntoSpecs);
    if (Object.keys(out).length === 0) document.querySelectorAll("table").forEach(mergeTableRowsIntoSpecs);

    const overviewChunks = [];
    document.querySelectorAll("div.product-overview").forEach((po) => {
      po.querySelectorAll("p.sub-title, h2.h3, h2, div.row div.col, div.col").forEach((n) => {
        const t = n.textContent.replace(/\s+/g, " ").trim();
        if (t) overviewChunks.push(t);
      });
    });
    const productOverviewText = overviewChunks.filter(Boolean).join("\n");

    return { specs: out, productOverviewText };
  });
  return { specs, productOverviewText };
}

function hostKind(sourceUrl) {
  try {
    const h = new URL(sourceUrl).hostname.toLowerCase();
    if (/royalmint\.com$/i.test(h)) return "royal_mint";
    if (/^(www\.)?pamp\.com$/i.test(h)) return "pamp";
    if (/monnaiedeparis\.fr$/i.test(h)) return "playwright_html";
    return "fetch";
  } catch {
    return "none";
  }
}

async function fetchHtmlViaPlaywright(page, url) {
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 55000 });
  await page.waitForTimeout(1400);
  return await page.content();
}

function parseMintFilterArgv() {
  const i = process.argv.indexOf("--mint");
  if (i === -1 || !process.argv[i + 1]) return [];
  return process.argv[i + 1]
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function rowMatchesMintFilter(r, needles) {
  if (!needles.length) return true;
  const hay = `${r.mint || ""} ${r.mint_short || ""}`.toLowerCase();
  return needles.some((n) => hay.includes(n.toLowerCase()));
}

async function main() {
  const apply = process.argv.includes("--apply");
  const limIdx = process.argv.indexOf("--limit");
  const limit = limIdx !== -1 && process.argv[limIdx + 1] ? parseInt(process.argv[limIdx + 1], 10) : null;
  const mintNeedles = parseMintFilterArgv();
  const REPORT_PATH = mintNeedles.length > 0 ? REPORT_MINT_FILTER : REPORT_DEFAULT;

  const conn = await mysql.createConnection(getConfig());
  let rows;
  try {
    const [r] = await conn.execute(
      `SELECT id, country, catalog_number, mintage, mintage_display, mint, mint_short, title, source_url
       FROM coins ORDER BY id`
    );
    rows = r;
  } finally {
    await conn.end();
  }

  const exported = rows.filter(rowKeptInExportCatalog);
  let gap = exported.filter((r) => coinNeedsMintageResearch(r));
  gap = gap.filter((r) => r.source_url && String(r.source_url).trim());
  if (mintNeedles.length > 0) gap = gap.filter((r) => rowMatchesMintFilter(r, mintNeedles));
  if (limit != null && limit > 0) gap = gap.slice(0, limit);

  const report = {
    generatedAt: new Date().toISOString(),
    apply,
    mintFilter: mintNeedles.length ? mintNeedles : undefined,
    reportPath: REPORT_PATH,
    totalQueued: gap.length,
    found: 0,
    notFound: 0,
    updated: 0,
    errors: [],
    items: [],
  };

  const rmNoMintageCache = loadRmNoMintageCache();
  let rmNoMintageCacheDirty = false;

  const rmRowsAll = gap.filter((r) => hostKind(String(r.source_url)) === "royal_mint");
  const rmRows = rmRowsAll.filter((r) => !isRmNoMintageCachedForRow(rmNoMintageCache, r));
  const pampRows = gap.filter((r) => hostKind(String(r.source_url)) === "pamp");
  const playwrightHtmlRows = gap.filter((r) => hostKind(String(r.source_url)) === "playwright_html");
  const fetchRows = gap.filter((r) => hostKind(String(r.source_url)) === "fetch");

  // Скорректируем очередь после пропуска RM по кэшу.
  report.totalQueued = rmRows.length + pampRows.length + playwrightHtmlRows.length + fetchRows.length;

  let browser;
  let page;
  let gqlCapture = null;
  if (rmRows.length > 0 || playwrightHtmlRows.length > 0 || pampRows.length > 0) {
    const { chromium } = require("playwright-extra");
    const StealthPlugin = require("puppeteer-extra-plugin-stealth");
    chromium.use(StealthPlugin());
    browser = await chromium.launch({ headless: process.env.HEADLESS !== "0", args: ["--no-sandbox"] });
    const context = await browser.newContext({
      locale: "en-GB",
      userAgent: UA,
      viewport: { width: 1280, height: 900 },
    });
    page = await context.newPage();
    if (pampRows.length > 0) gqlCapture = attachGqlProductCapture(page);
  }

  let applyConn = null;
  if (apply) applyConn = await mysql.createConnection(getConfig());

  async function handleRow(r, specsOrHtml, method) {
    const id = Number(r.id);
    let parsed = null;
    let rmMintageSource = null;
    if (method === "rm_specs") {
      const fromOverview = parseMintageFromProductOverview(specsOrHtml.productOverviewText);
      parsed = parseMintageFromSpecsOrOverview(specsOrHtml.specs, specsOrHtml.productOverviewText);
      if (parsed && parsed.mintage != null) {
        rmMintageSource = fromOverview.mintage != null ? "product_overview" : "spec_table";
      }
    } else if (method === "pamp") {
      const pm = parsePampMintageFromSpecs(specsOrHtml.specs, specsOrHtml.title);
      if (pm.mintage != null && saneMintage(pm.mintage)) {
        parsed = { mintage: pm.mintage, mintage_display: (pm.mintageDisplay || String(pm.mintage)).trim() };
      }
    } else if (method === "html") parsed = extractMintageFromHtml(specsOrHtml);

    if (parsed && saneMintage(parsed.mintage)) {
      report.found++;
      const disp = `${String(parsed.mintage_display || parsed.mintage).trim()}${MINTAGE_NOTE}`;
      const item = {
        id,
        source_url: String(r.source_url).trim(),
        method,
        mintage: parsed.mintage,
        mintage_display_out: disp,
      };
      if (rmMintageSource) item.rm_mintage_source = rmMintageSource;
      report.items.push(item);

      if (applyConn) {
        const [[row]] = await applyConn.execute(
          "SELECT id, mintage, mintage_display FROM coins WHERE id = ? LIMIT 1",
          [id]
        );
        if (row && coinNeedsMintageResearch(row)) {
          await applyConn.execute("UPDATE coins SET mintage = ?, mintage_display = ? WHERE id = ?", [
            parsed.mintage,
            disp,
            id,
          ]);
          report.updated++;
        }
      }
    } else {
      report.notFound++;
      if (method === "rm_specs") {
        const hasOverview = String(specsOrHtml?.productOverviewText || "").trim().length > 0;
        const hasSpecs = !!(specsOrHtml?.specs && Object.keys(specsOrHtml.specs).length > 0);
        const canCache = hasOverview || hasSpecs;

        if (canCache) {
          rmNoMintageCache.items[String(r.id)] = {
            reason: "no_mintage_on_page",
            source_url: rmCanonicalSourceUrlForCache(r.source_url),
            cachedAt: new Date().toISOString(),
            hasOverview,
            hasSpecs,
          };
          rmNoMintageCacheDirty = true;
          report.items.push({
            id,
            source_url: String(r.source_url).trim(),
            method,
            mintage: null,
            note: "not_found_on_page",
          });
        } else {
          // Не кэшируем: скорее неполная загрузка/скрейп.
          report.items.push({
            id,
            source_url: String(r.source_url).trim(),
            method,
            mintage: null,
            note: "not_found_on_page_incomplete_scrape",
          });
        }
      } else {
        report.items.push({
          id,
          source_url: String(r.source_url).trim(),
          method,
          mintage: null,
          note: "not_found_on_page",
        });
      }
    }
  }

  try {
    for (let i = 0; i < rmRows.length; i++) {
      const r = rmRows[i];
      process.stderr.write(`\r[Royal Mint ${i + 1}/${rmRows.length}] id ${r.id}   `);
      try {
        const rmPayload = await scrapeRoyalMintSpecsPlaywright(page, String(r.source_url).trim());
        await handleRow(r, rmPayload, "rm_specs");
      } catch (e) {
        report.errors.push({ id: r.id, error: String(e.message || e) });
        report.notFound++;
        report.items.push({ id: Number(r.id), error: String(e.message || e) });
      }
      await sleep(DELAY_RM_MS);
    }

    for (let i = 0; i < pampRows.length; i++) {
      const r = pampRows[i];
      process.stderr.write(`\r[PAMP ${i + 1}/${pampRows.length}] id ${r.id}   `);
      try {
        const { specs, title } = await parsePampProductPageLight(page, gqlCapture, String(r.source_url).trim());
        await handleRow(r, { specs, title }, "pamp");
      } catch (e) {
        report.errors.push({ id: r.id, error: String(e.message || e) });
        report.notFound++;
        report.items.push({ id: Number(r.id), error: String(e.message || e) });
      }
      await sleep(DELAY_RM_MS);
    }

    for (let i = 0; i < playwrightHtmlRows.length; i++) {
      const r = playwrightHtmlRows[i];
      process.stderr.write(`\r[playwright ${i + 1}/${playwrightHtmlRows.length}] id ${r.id}   `);
      try {
        const html = await fetchHtmlViaPlaywright(page, String(r.source_url).trim());
        await handleRow(r, html, "html");
      } catch (e) {
        report.errors.push({ id: r.id, error: String(e.message || e) });
        report.notFound++;
        report.items.push({ id: Number(r.id), error: String(e.message || e) });
      }
      await sleep(DELAY_RM_MS);
    }

    for (let i = 0; i < fetchRows.length; i++) {
      const r = fetchRows[i];
      process.stderr.write(`\r[fetch ${i + 1}/${fetchRows.length}] id ${r.id}   `);
      const html = await fetchText(String(r.source_url).trim());
      if (!html) {
        report.notFound++;
        report.items.push({ id: Number(r.id), source_url: r.source_url, method: "fetch", note: "http_fail" });
      } else {
        await handleRow(r, html, "html");
      }
      await sleep(DELAY_FETCH_MS);
    }
  } finally {
    if (browser) await browser.close();
    if (applyConn) await applyConn.end();
  }

  process.stderr.write("\n");
  if (rmNoMintageCacheDirty) {
    try {
      fs.writeFileSync(RM_NO_MINTAGE_CACHE_PATH, JSON.stringify(rmNoMintageCache, null, 2), "utf8");
    } catch (e) {
      console.warn("[fetch-mintage-export-gap] не удалось сохранить RM no-mintage cache:", e.message || e);
    }
  }
  fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2), "utf8");
  console.log(
    JSON.stringify(
      {
        ...report,
        items: `[${report.items.length} строк, см. файл]`,
      },
      null,
      2
    )
  );
  console.log("\nПолный отчёт:", REPORT_PATH);
  if (apply) console.log("Обновлено строк в БД:", report.updated, "| Далее: npm run data:export");
  else console.log("Сухой прогон. Запись в БД: --apply");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
