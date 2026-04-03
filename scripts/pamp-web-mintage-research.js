/**
 * Внешний поиск тиражей для PAMP из reports/pamp-missing-mintage.json (по полному англ. названию).
 *
 * По умолчанию (без поисковика): встроенный поиск на **4 крупных дилерских сайтах** → ссылки из выдачи → разбор PDP.
 * Опционально `--bing`: прежняя схема Bing site: + Playwright (медленнее, чаще антибот).
 *
 * На страницах (кроме pamp.com) ищем число рядом с mintage / limited edition / issue limit / …;
 * одна цифра на ≥2 доменах — verified; расхождение — conflict в sources; один домен — partial.
 *
 *   node scripts/pamp-web-mintage-research.js
 *   node scripts/pamp-web-mintage-research.js --max-dealers 4      — сколько дилеров обходить (по умол. 4)
 *   node scripts/pamp-web-mintage-research.js --bing               — режим через Bing + Chromium
 *   node scripts/pamp-web-mintage-research.js --limit 20 --redo
 *
 * Playwright нужен только с флагом `--bing`.
 */
require("dotenv").config({ path: ".env" });
const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");

const ROOT = path.join(__dirname, "..");
const REPORT_JSON = path.join(ROOT, "reports", "pamp-missing-mintage.json");
const REPORT_MD = path.join(ROOT, "reports", "pamp-missing-mintage.md");

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

const OFFICIAL_HOST_RE = /\b(pamp\.com)\b/i;
const MAX_MINTAGE = 50_000_000;

/** Таймауты сети (мс). Чуть короче дефолта — меньше «простоя» на Bing/тяжёлых сайтах; при обрывах увеличьте или используйте --bing-challenge-ms */
const TIMEOUT = {
  /** Загрузка HTML дилера / каталога */
  dealerFetch: 18_000,
  fetchTextDefault: 18_000,
  /** Bing: domcontentloaded */
  bingGoto: 17_000,
  bingPauseAfterLoad: 400,
  /** Ожидание блока результатов, если страница без challenge */
  bingResultsNoChallenge: 6000,
  /** Headless: challenge почти всегда не пройти автоматически — короткое ожидание */
  bingChallengeHeadlessDefault: 7500,
  /** Headful: время на ручной проход проверки */
  bingChallengeHeadfulDefault: 150_000,
};

/**
 * Топ дилеры US: встроенный поиск (как royal-mint direct-sites).
 * URL шаблоны при необходимости правьте под изменения вёрстки магазинов.
 */
const PAMP_DEALER_SITES = [
  {
    host: "apmex.com",
    origin: "https://www.apmex.com",
    buildUrl: (q) => `https://www.apmex.com/search?q=${encodeURIComponent(q)}`,
  },
  {
    host: "jmbullion.com",
    origin: "https://www.jmbullion.com",
    buildUrl: (q) => `https://www.jmbullion.com/search/?q=${encodeURIComponent(q)}`,
  },
  {
    host: "govmint.com",
    origin: "https://www.govmint.com",
    buildUrl: (q) => `https://www.govmint.com/?s=${encodeURIComponent(q)}`,
  },
  {
    host: "moderncoinmart.com",
    origin: "https://www.moderncoinmart.com",
    buildUrl: (q) =>
      `https://www.moderncoinmart.com/catalogsearch/result/?q=${encodeURIComponent(q)}`,
  },
];

/** Для режима `--bing`: site: перебор */
const SEARCH_SITES = [
  "numista.com",
  "apmex.com",
  "govmint.com",
  "jmbullion.com",
  "moderncoinmart.com",
  "bullionexchanges.com",
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function parseArgInt(flag, def) {
  const i = process.argv.indexOf(flag);
  if (i === -1 || !process.argv[i + 1]) return def;
  const n = parseInt(process.argv[i + 1], 10);
  return Number.isFinite(n) && n > 0 ? n : def;
}

function hasFlag(flag) {
  return process.argv.includes(flag);
}

function safeWriteJson(filePath, data) {
  const tmp = `${filePath}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), "utf8");
  fs.renameSync(tmp, filePath);
}

function normSpace(s) {
  return String(s || "").replace(/\s+/g, " ").trim();
}

/** В тексте поиска всегда уточняем PAMP, чтобы выдача не смешивалась с Royal Mint и др. */
function ensurePampSearchContext(q) {
  const s = normSpace(q);
  if (!s) return "";
  if (/\bpamp\b/i.test(s)) return s;
  return normSpace(`${s} PAMP`);
}

function saneMintage(n) {
  return Number.isFinite(n) && n >= 1 && n <= MAX_MINTAGE;
}

function digitsToInt(s) {
  const d = String(s).replace(/[^\d]/g, "");
  if (!d || d.length < 2) return null;
  const n = parseInt(d.slice(0, 12), 10);
  return saneMintage(n) ? n : null;
}

function hostnameOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return "";
  }
}

function isOfficial(url) {
  return OFFICIAL_HOST_RE.test(hostnameOf(url));
}

async function fetchText(url, timeoutMs = TIMEOUT.fetchTextDefault) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": UA,
        "Accept-Language": "en-US,en;q=0.9",
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      },
      redirect: "follow",
      signal: ctrl.signal,
    });
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}`, text: "" };
    return { ok: true, text: await res.text() };
  } catch (e) {
    return { ok: false, error: String(e.message || e), text: "" };
  } finally {
    clearTimeout(t);
  }
}

function bingSearchUrl(query, first = 1) {
  return `https://www.bing.com/search?q=${encodeURIComponent(query)}&first=${first}&setmkt=en-US&setlang=en-US`;
}

function decodeBingClickUrl(u) {
  try {
    const uu = new URL(u);
    if (uu.hostname.endsWith("bing.com") && uu.pathname.startsWith("/ck/a")) {
      const enc = uu.searchParams.get("u");
      if (enc && enc.startsWith("a1")) {
        const b64 = enc.slice(2).replace(/-/g, "+").replace(/_/g, "/");
        const padded = b64 + "===".slice((b64.length + 3) % 4);
        const dest = Buffer.from(padded, "base64").toString("utf8");
        if (/^https?:\/\//i.test(dest)) return dest;
      }
    }
  } catch {
    /* ignore */
  }
  return u;
}

function extractLinksFromHtml(html, origin) {
  let originUrl;
  try {
    originUrl = new URL(origin);
  } catch {
    return [];
  }
  const baseHostNorm = originUrl.hostname.replace(/^www\./, "").toLowerCase();
  const out = [];
  const seen = new Set();
  const re = /<a\b[^>]*\bhref=(['"])([^'"]+)\1/gi;
  let m;
  while ((m = re.exec(html))) {
    let u = (m[2] || "").trim();
    if (!u || u.startsWith("#") || /^javascript:/i.test(u)) continue;
    u = u.replace(/&amp;/g, "&");
    if (u.startsWith("//")) u = "https:" + u;
    if (u.startsWith("/")) u = originUrl.origin + u;
    if (!/^https?:\/\//i.test(u)) continue;
    let hostNorm;
    try {
      hostNorm = new URL(u).hostname.replace(/^www\./, "").toLowerCase();
    } catch {
      continue;
    }
    if (hostNorm !== baseHostNorm && !hostNorm.endsWith("." + baseHostNorm)) continue;
    try {
      const uu = new URL(u);
      uu.hash = "";
      uu.searchParams.delete("replytocom");
      u = uu.toString();
    } catch {
      continue;
    }
    if (seen.has(u)) continue;
    seen.add(u);
    out.push(u);
  }
  return out;
}

function filterDealerProductLinks(urls, queryHint) {
  const qTokens = normSpace(queryHint || "")
    .toLowerCase()
    .split(/\s+/)
    .map((x) => x.replace(/[^a-z0-9]/g, ""))
    .filter((x) => x.length >= 4)
    .slice(0, 8);
  const filtered = [];
  const seenPath = new Set();
  for (const u of urls) {
    try {
      const uu = new URL(u);
      const p = uu.pathname.replace(/\/+$/, "");
      if (!p || p === "/") continue;
      if (/\/(cart|checkout|account|login|customer|wishlist)(\/|$)/i.test(p)) continue;
      if (seenPath.has(p)) continue;
      const urlLc = u.toLowerCase();
      const hasYear = /\b(19|20)\d{2}\b/.test(urlLc);
      const hasToken = qTokens.length ? qTokens.some((t) => urlLc.includes(t)) : false;
      if (qTokens.length >= 2 && !hasYear && !hasToken) continue;
      seenPath.add(p);
      filtered.push(u);
      if (filtered.length >= 8) break;
    } catch {
      continue;
    }
  }
  return filtered;
}

async function collectLinksFromDealers(item, dealers, maxLinksTotal) {
  const fullTitle = normSpace(item.title_en || item.title || "");
  const compact = fullTitle.replace(/[®™]/g, "").replace(/\s+/g, " ").trim();
  const shortTok = compact
    .split(/\s+/)
    .filter((w) => w.replace(/[^A-Za-z0-9]/g, "").length > 3)
    .slice(0, 10)
    .join(" ");
  const qPamp = ensurePampSearchContext(compact);
  const qPampSuisse =
    /\bsuisse\b/i.test(qPamp) ? null : normSpace(`${qPamp} Suisse`);
  const qShort = ensurePampSearchContext(shortTok);
  const attemptQueries = [...new Set([qPamp, qPampSuisse, qShort].filter(Boolean).map(normSpace))].filter(
    (q) => q.length > 6
  );

  const links = [];
  const seen = new Set();
  for (const d of dealers) {
    for (const q of attemptQueries) {
      if (links.length >= maxLinksTotal) return links;
      const searchUrl = d.buildUrl(q);
      const r = await fetchText(searchUrl, TIMEOUT.dealerFetch);
      if (!r.ok || !r.text) continue;
      const extracted = extractLinksFromHtml(r.text, d.origin);
      const picked = filterDealerProductLinks(extracted, q);
      for (const u of picked) {
        if (seen.has(u) || isOfficial(u)) continue;
        seen.add(u);
        links.push(u);
        if (links.length >= maxLinksTotal) return links;
      }
      await sleep(120);
    }
    await sleep(200);
  }
  return links;
}

/**
 * @param {{ headful?: boolean; challengeTimeoutMs?: number }} bingOpts
 * В headless при антиботе не ждём долго (раньше было до 5 мин на каждый site: — весь прогон «висел»).
 */
async function searchBingWithPlaywright(browser, query, maxLinks, bingOpts = {}) {
  const headful = !!bingOpts.headful;
  const challengeTimeoutMs =
    typeof bingOpts.challengeTimeoutMs === "number" && bingOpts.challengeTimeoutMs > 0
      ? bingOpts.challengeTimeoutMs
      : headful
        ? TIMEOUT.bingChallengeHeadfulDefault
        : TIMEOUT.bingChallengeHeadlessDefault;

  const page = await browser.newPage();
  try {
    await page.setExtraHTTPHeaders({ "Accept-Language": "en-US,en;q=0.9" });
    await page.goto(bingSearchUrl(query, 1), {
      waitUntil: "domcontentloaded",
      timeout: TIMEOUT.bingGoto,
    });
    await page.waitForTimeout(TIMEOUT.bingPauseAfterLoad);

    const needsChallenge = await page.evaluate(() => {
      const t = document.body && document.body.innerText ? document.body.innerText : "";
      return (
        /solve the challenge/i.test(t) ||
        /one last step/i.test(t) ||
        /unusual traffic/i.test(t) ||
        /are you a robot/i.test(t) ||
        /проверка безопасности/i.test(t)
      );
    });
    if (needsChallenge) {
      await page.waitForSelector("li.b_algo", { timeout: challengeTimeoutMs }).catch(() => {});
      await page.waitForTimeout(300);
    } else {
      await page.waitForSelector("li.b_algo", { timeout: TIMEOUT.bingResultsNoChallenge }).catch(() => {});
    }

    const rawLinks = await page.evaluate(() => {
      const out = [];
      document.querySelectorAll("li.b_algo h2 a").forEach((a) => {
        const href = a.getAttribute("href");
        if (href) out.push(href);
      });
      return out;
    });
    const links = [];
    for (const u0 of rawLinks || []) {
      let u = String(u0 || "").trim();
      if (!u) continue;
      u = u.replace(/&amp;/g, "&");
      if (u.startsWith("//")) u = "https:" + u;
      if (!/^https?:\/\//i.test(u)) continue;
      u = decodeBingClickUrl(u);
      const host = hostnameOf(u);
      if (!host || host.endsWith("bing.com") || host.endsWith("r.bing.com")) continue;
      links.push(u);
      if (links.length >= maxLinks) break;
    }
    return links;
  } catch {
    return [];
  } finally {
    await page.close().catch(() => {});
  }
}

function extractMintageFromPageText(text) {
  const t = normSpace(text);
  if (!t) return null;

  const patterns = [
    /\bedition\s+limit\b[^0-9]{0,40}([0-9][0-9,.\s\u00A0]{0,20})/i,
    /\blimited\s+edition\b[^0-9]{0,40}([0-9][0-9,.\s\u00A0]{0,20})/i,
    /\bissue\s+limit\s+of\b[^0-9]{0,20}([0-9][0-9,.\s\u00A0]{0,20})/i,
    /\bissue\s+limit\b[^0-9]{0,40}([0-9][0-9,.\s\u00A0]{0,20})/i,
    /\bmintage\b[^0-9]{0,40}([0-9][0-9,.\s\u00A0]{0,20})/i,
    /\blimited\s+mintage\s+of\b[^0-9]{0,40}([0-9][0-9,.\s\u00A0]{0,20})/i,
    /\bonly\b[^0-9]{0,20}([0-9][0-9,.\s\u00A0]{3,20})\s*(?:coins?|pieces?|bars?|struck)?/i,
    /\btirage\b[^0-9]{0,40}([0-9][0-9\s\u00A0]{0,20})/i,
    /\bauflage\b[^0-9]{0,40}([0-9][0-9.\s\u00A0]{0,20})/i,
  ];

  for (const re of patterns) {
    const m = t.match(re);
    if (!m || !m[1]) continue;
    const n = digitsToInt(m[1]);
    if (n == null) continue;
    return { mintage: n, quotedText: normSpace(m[0]).slice(0, 220) };
  }
  return null;
}

function buildQuery(item) {
  const raw = normSpace(item.title_en || item.title || "");
  const title = raw
    .replace(/[®™]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  const year = (title.match(/\b(19|20)\d{2}\b/) || [])[0] || "";
  const withMint = ensurePampSearchContext(title);
  return normSpace(`${withMint} ${year} mintage "limited edition"`.replace(/\s+/g, " ").trim().slice(0, 220));
}

function computeVerified(proposals) {
  const byNum = new Map();
  for (const p of proposals) {
    const n = p.mintage;
    if (!Number.isFinite(n)) continue;
    const key = String(n);
    if (!byNum.has(key)) byNum.set(key, []);
    byNum.get(key).push(p);
  }
  for (const [k, arr] of byNum.entries()) {
    const hosts = new Set(arr.map((x) => x.host).filter(Boolean));
    if (hosts.size >= 2) {
      return { verifiedMintage: parseInt(k, 10), agreeingHosts: [...hosts].slice(0, 12) };
    }
  }
  return { verifiedMintage: null, agreeingHosts: [] };
}

function relevanceTokensForItem(item) {
  const title = normSpace(item.title_en || item.title || "");
  const stop = new Set([
    "the",
    "and",
    "for",
    "with",
    "coin",
    "silver",
    "gold",
    "bar",
    "pure",
    "fine",
    "minted",
    "pamp",
    "oz",
    "tuvalu",
    "niue",
  ]);
  const tokens = [];
  const acr = title.match(/\b[A-Z]{2,}\b/g) || [];
  tokens.push(...acr.map((x) => x.toLowerCase()));
  const year = (title.match(/\b(19|20)\d{2}\b/) || [])[0];
  if (year) tokens.push(year);
  for (const w of title.split(/[\s-]+/)) {
    const t = w.replace(/[^A-Za-z0-9]/g, "").toLowerCase();
    if (!t || t.length < 4) continue;
    if (stop.has(t)) continue;
    tokens.push(t);
    if (tokens.length >= 12) break;
  }
  return [...new Set(tokens)].slice(0, 12);
}

function pageLooksRelevant(item, html) {
  const t = String(html || "").toLowerCase();
  if (!t) return false;
  const tokens = relevanceTokensForItem(item);
  if (!tokens.length) return true;
  const hits = tokens.filter((x) => t.includes(x)).length;
  return hits >= 2 || (hits === 1 && tokens.some((x) => x.length >= 8));
}

function urlLooksRelevant(item, url) {
  const u = String(url || "").toLowerCase();
  if (!u) return false;
  const tokens = relevanceTokensForItem(item).filter((x) => x.length >= 4);
  if (tokens.length >= 2) {
    const hit = tokens.filter((x) => u.includes(x)).length;
    if (hit >= 1) return true;
  }
  const year = (normSpace(item.title_en || item.title || "").match(/\b(19|20)\d{2}\b/) || [])[0];
  if (year && u.includes(year)) return true;
  return tokens.length === 0;
}

function relevanceForPage(item, url, html) {
  const u = String(url || "").toLowerCase();
  const t = normSpace(String(html || "")).toLowerCase();
  const anchors = relevanceTokensForItem(item);
  if (!anchors.length) return { ok: true, matched: [] };
  const matched = anchors.filter((a) => u.includes(a) || t.includes(a));
  const ok = matched.length >= 2 || (matched.length >= 1 && anchors.some((a) => a.length >= 8 && matched.includes(a)));
  return { ok, matched: matched.slice(0, 8) };
}

function buildMintageSource(proposals, query, methodLabel) {
  const sources = proposals.map((p) => ({
    host: p.host,
    url: p.sourceUrl,
    mintage: p.mintage,
    quoted_text: p.quotedText || null,
  }));

  const { verifiedMintage, agreeingHosts } = computeVerified(proposals);
  const distinctNums = [...new Set(proposals.map((p) => p.mintage).filter(Number.isFinite))].sort((a, b) => a - b);

  let status = "none";
  if (verifiedMintage != null) status = "verified";
  else if (proposals.length > 0 && distinctNums.length >= 2) status = "conflict";
  else if (proposals.length > 0) status = "partial";

  return {
    researched_at: new Date().toISOString(),
    method: methodLabel,
    query_used: query,
    status,
    verified_mintage: verifiedMintage,
    agreeing_hosts: agreeingHosts,
    sources,
    note:
      verifiedMintage != null
        ? `Совпадение тиража на ${agreeingHosts.length} доменах. Проверьте вручную перед занесением в БД.`
        : status === "conflict"
          ? "Разные цифры на разных сайтах — ручной выбор источника."
          : proposals.length
            ? "Только один домен дал число — желательно второй источник."
            : "Число тиража в выдаче не найдено.",
  };
}

async function runOne(item, opts) {
  const baseQuery = buildQuery(item);
  let links = [];
  const methodLabel = opts.useBing ? "bing_site_search_dealer_numismatic" : "dealer_internal_search_top4";

  if (opts.useBing) {
    if (!opts.browser) throw new Error("режим Bing: browser не передан");
    const bingCtx = { headful: opts.headful, challengeTimeoutMs: opts.challengeTimeoutMs };
    const sites = SEARCH_SITES.slice(0, opts.maxSites);

    for (const site of sites) {
      const q = `site:${site} ${baseQuery}`;
      const found = await searchBingWithPlaywright(opts.browser, q, 3, bingCtx);
      for (const u of found) {
        if (!isOfficial(u)) links.push(u);
      }
      if (links.length >= opts.maxLinks) break;
      await sleep(160);
    }

    if (links.length < opts.maxLinks) {
      const found = await searchBingWithPlaywright(
        opts.browser,
        `${baseQuery} coin silver gold bar`,
        opts.maxLinks,
        bingCtx
      );
      for (const u of found) {
        if (!isOfficial(u) && !links.includes(u)) links.push(u);
      }
    }
  } else {
    const dealers = PAMP_DEALER_SITES.slice(0, opts.maxDealers);
    links = await collectLinksFromDealers(item, dealers, opts.maxLinks);
  }

  const proposals = [];
  for (const u of links.slice(0, opts.maxLinks)) {
    if (!urlLooksRelevant(item, u)) continue;
    const host = hostnameOf(u);
    if (!host || isOfficial(u)) continue;
    if (proposals.some((p) => p.host === host)) continue;

    const page = await fetchText(u, TIMEOUT.dealerFetch);
    if (!page.ok || !page.text) continue;
    if (!pageLooksRelevant(item, page.text)) continue;
    const rel = relevanceForPage(item, u, page.text);
    if (!rel.ok) continue;
    const parsed = extractMintageFromPageText(page.text);
    if (!parsed) continue;
    proposals.push({
      mintage: parsed.mintage,
      host,
      sourceUrl: u,
      quotedText: parsed.quotedText,
      matchedAnchors: rel.matched,
    });

    if (computeVerified(proposals).verifiedMintage != null) break;
    if (proposals.length >= 4) break;
    await sleep(220);
  }

  return buildMintageSource(proposals, baseQuery, methodLabel);
}

function escapeMdCell(s) {
  if (s == null) return "";
  return String(s).replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
}

function webSummaryCell(row) {
  const ms = row.mintage_source;
  if (!ms) return "";
  if (ms.status === "verified" && ms.verified_mintage != null) return String(ms.verified_mintage);
  if (ms.status === "conflict") return "конфликт";
  if (ms.status === "partial" && ms.sources && ms.sources[0]) return `~${ms.sources[0].mintage}`;
  return ms.status === "none" ? "—" : "";
}

function rewriteMarkdown(doc) {
  const mdLines = [
    `# PAMP: монеты без тиража (нужен research)`,
    ``,
    `- **Сгенерировано (отчёт):** ${doc.generatedAt}`,
    `- **Всего PAMP в БД (выборка):** ${doc.totalPampInDbQuery}`,
    `- **Без тиража:** ${doc.missingCount}`,
    ``,
    `Колонка **web**: черновик тиража с популярных сайтов (см. mintage_source в JSON). Не подставлять в БД без проверки.`,
    ``,
    `Критерий: ${doc.criteria}`,
    ``,
    `| id | web | catalog_number | title | source_url |`,
    `| ---: | --- | --- | --- | --- |`,
  ];
  for (const row of doc.rows) {
    mdLines.push(
      `| ${row.id} | ${escapeMdCell(webSummaryCell(row))} | ${escapeMdCell(row.catalog_number)} | ${escapeMdCell(row.title)} | ${escapeMdCell(row.source_url)} |`
    );
  }
  fs.writeFileSync(REPORT_MD, mdLines.join("\n"), "utf8");
}

async function main() {
  if (!fs.existsSync(REPORT_JSON)) {
    console.error("Нет файла:", REPORT_JSON, "— сначала npm run pamp:report-mintage");
    process.exit(1);
  }

  const limit = parseArgInt("--limit", null);
  /** Параллельные вкладки Bing чаще ловят антибот — по умолчанию 1 */
  const concurrency = Math.min(4, Math.max(1, parseArgInt("--concurrency", 1)));
  const maxLinks = parseArgInt("--max-links", 10);
  const maxSites = parseArgInt("--max-sites", 6);
  const maxDealers = Math.min(PAMP_DEALER_SITES.length, Math.max(1, parseArgInt("--max-dealers", 4)));
  const useBing = hasFlag("--bing");
  const headful = hasFlag("--headful");
  const challengeArg = parseArgInt("--bing-challenge-ms", null);
  const challengeTimeoutMs =
    challengeArg != null ? challengeArg : headful ? TIMEOUT.bingChallengeHeadfulDefault : TIMEOUT.bingChallengeHeadlessDefault;
  const redo = hasFlag("--redo");
  const checkpointEvery = parseArgInt("--checkpoint-every", 5);

  const doc = JSON.parse(fs.readFileSync(REPORT_JSON, "utf8"));
  const rows = doc.rows || [];
  let cohort = rows.map((r, i) => ({ r, i }));
  if (!redo) {
    cohort = cohort.filter(({ r }) => {
      const ms = r.mintage_source;
      if (!ms || typeof ms !== "object") return true;
      return ms.status !== "verified";
    });
  }
  if (limit) cohort = cohort.slice(0, limit);

  const logParts = [
    "Строк всего:",
    rows.length,
    "| к обработке:",
    cohort.length,
    "| режим:",
    useBing ? "Bing+Playwright" : `только дилеры (${maxDealers})`,
    "| concurrency:",
    concurrency,
  ];
  if (useBing) {
    logParts.push(
      "| maxSites:",
      maxSites,
      "| bingChallengeMs:",
      challengeTimeoutMs,
      headful ? "(headful)" : "(headless)"
    );
  }
  console.log(...logParts);

  const browser = useBing ? await chromium.launch({ headless: !headful }) : null;
  let processed = 0;
  let idx = 0;

  async function worker() {
    while (true) {
      const my = idx++;
      if (my >= cohort.length) return;
      const { r, i } = cohort[my];
      process.stdout.write(`\r[PAMP web ${my + 1}/${cohort.length}] id ${r.id}   `);
      try {
        r.mintage_source = await runOne(r, {
          browser,
          maxLinks,
          maxSites,
          maxDealers,
          useBing,
          headful,
          challengeTimeoutMs,
        });
        rows[i] = r;
      } catch (e) {
        r.mintage_source = {
          researched_at: new Date().toISOString(),
          method: useBing ? "bing_site_search_dealer_numismatic" : "dealer_internal_search_top4",
          status: "none",
          verified_mintage: null,
          agreeing_hosts: [],
          sources: [],
          note: String(e.message || e),
          query_used: buildQuery(r),
        };
        rows[i] = r;
      }
      processed++;
      doc.rows = rows;
      if (checkpointEvery && processed % checkpointEvery === 0) {
        safeWriteJson(REPORT_JSON, doc);
        rewriteMarkdown(doc);
      }
      await sleep(400);
    }
  }

  await Promise.all(Array.from({ length: concurrency }, () => worker()));
  process.stdout.write("\n");
  if (browser) await browser.close().catch(() => {});

  doc.rows = rows;
  safeWriteJson(REPORT_JSON, doc);
  rewriteMarkdown(doc);
  console.log("Готово:", REPORT_JSON);
  console.log("Markdown:", REPORT_MD);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
