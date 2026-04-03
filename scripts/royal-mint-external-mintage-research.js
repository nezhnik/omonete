/**
 * Внешний (неофициальный) поиск тиражей для Royal Mint монет, по которым:
 * - уже прошлись по официальному PDP (fetch-mintage-export-gap-from-official.js), и
 * - тираж не найден (кэш reports/mintage-export-gap-no-mintage-cache-rm.json).
 *
 * Логика:
 * - для каждой монеты делаем DDG Lite запрос (веб) и собираем N результатов;
 * - для каждой страницы (не официальный домен) пытаемся вытащить число рядом с ключевыми словами:
 *   mintage / limited edition / edition limit / issue limit / tirage / auflage / nakład / etc.
 * - сохраняем proposals (с цитатой/фрагментом).
 * - если один и тот же номер встречается на >=2 разных доменах — ставим verifiedMintage.
 *
 * В БД НЕ пишет. Результат: reports/royal-mint-external-mintage-research.json
 *
 * Запуск:
 *   node scripts/royal-mint-external-mintage-research.js
 *   node scripts/royal-mint-external-mintage-research.js --limit 50
 *   node scripts/royal-mint-external-mintage-research.js --concurrency 3
 */
require("dotenv").config({ path: ".env" });
const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");

const ROOT = path.join(__dirname, "..");
const EXPORT_GAP = path.join(ROOT, "reports", "mintage-export-gap-research.json");
const RM_CACHE = path.join(ROOT, "reports", "mintage-export-gap-no-mintage-cache-rm.json");
const OUT_DEFAULT = path.join(ROOT, "reports", "royal-mint-external-mintage-research.json");

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

const OFFICIAL_HOST_RE = /\.(royalmint\.com)\b/i;
const MAX_MINTAGE = 50_000_000;
const SEARCH_SITES = [
  // популярные источники/дилеры + каталоги
  "coinparade.co.uk",
  "thecoinexpert.co.uk",
  "westminstercollection.com",
  "coinchecker.co.uk",
  "chards.co.uk",
  "ukcoinhunt.com",
  "numista.com",
  "allcollect.com",
  "coincommunity.com",
  "onlinecoin.club",
];

// Сайты, на которых пробуем “встроенный поиск” (без поисковиков).
// Сейчас ограничиваемся теми, где обычно есть простой HTML поиск (часто WordPress).
const DIRECT_SEARCH_SITES = [
  { host: "coinparade.co.uk", kind: "wp" },
  { host: "thecoinexpert.co.uk", kind: "wp" },
  { host: "westminstercollection.com", kind: "wp" },
  { host: "coinchecker.co.uk", kind: "wp" },
  { host: "chards.co.uk", kind: "wp" },
  { host: "ukcoinhunt.com", kind: "wp" },
  { host: "onlinecoin.club", kind: "generic" },
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

function parseArgString(flag, def) {
  const i = process.argv.indexOf(flag);
  if (i === -1 || !process.argv[i + 1]) return def;
  return String(process.argv[i + 1]);
}

function parseArgStrings(flag) {
  const out = [];
  for (let i = 0; i < process.argv.length; i++) {
    if (process.argv[i] === flag && process.argv[i + 1]) out.push(String(process.argv[i + 1]));
  }
  return out;
}

function tsCompact(d = new Date()) {
  // 2026-04-02T10:19:04.422Z -> 20260402-101904
  const iso = d.toISOString();
  return iso.replace(/[-:]/g, "").replace("T", "-").slice(0, 15);
}

function safeWriteJson(filePath, data) {
  const tmp = `${filePath}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), "utf8");
  fs.renameSync(tmp, filePath);
}

function normSpace(s) {
  return String(s || "").replace(/\s+/g, " ").trim();
}

function saneMintage(n) {
  return Number.isFinite(n) && n >= 1 && n <= MAX_MINTAGE;
}

function digitsToInt(s) {
  const d = String(s).replace(/[^\d]/g, "");
  // Минимум 2 цифры, чтобы не ловить "1" из фраз вроде "one of 1".
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

async function fetchText(url, timeoutMs = 25000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": UA,
        "Accept-Language": "en-GB,en;q=0.9",
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
  // Фиксируем рынок/язык, иначе выдача может быть “мусорной” из‑за гео/куки.
  return `https://www.bing.com/search?q=${encodeURIComponent(query)}&first=${first}&setmkt=en-GB&setlang=en-GB&cc=GB`;
}

function decodeBingClickUrl(u) {
  // Bing часто выдаёт редиректы вида:
  // https://www.bing.com/ck/a?...&u=a1aHR0cHM6Ly9leGFtcGxlLmNvbS8...
  // где u= "a1" + base64(url)
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

async function searchBingWithPlaywright(browser, query, maxLinks) {
  const page = await browser.newPage();
  try {
    await page.setExtraHTTPHeaders({ "Accept-Language": "en-GB,en;q=0.9" });
    await page.goto(bingSearchUrl(query, 1), { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForTimeout(600);

    // Если Bing показал антибот-челлендж, в headful режиме дадим время решить его руками.
    const needsChallenge = await page.evaluate(() => {
      const t = (document.body && document.body.innerText) ? document.body.innerText : "";
      return /solve the challenge/i.test(t) || /one last step/i.test(t);
    });
    if (needsChallenge) {
      await page.waitForSelector("li.b_algo", { timeout: 300000 }).catch(() => {});
      await page.waitForTimeout(400);
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

function siteSearchUrl(host, query, kind) {
  if (kind === "wp") return `https://${host}/?s=${encodeURIComponent(query)}`;
  // generic: иногда /search?q=..., но у разных сайтов по-разному. Для generic используем wp-совместимый путь как попытку.
  return `https://${host}/?s=${encodeURIComponent(query)}`;
}

function extractLinksFromHtml(html, baseHost) {
  // Очень простой извлекатель ссылок: берём href из <a>, нормализуем, оставляем только внешние http(s).
  const out = [];
  const seen = new Set();
  const re = /<a\b[^>]*\bhref=(['"])([^'"]+)\1/gi;
  let m;
  while ((m = re.exec(html))) {
    let u = (m[2] || "").trim();
    if (!u) continue;
    u = u.replace(/&amp;/g, "&");
    if (u.startsWith("//")) u = "https:" + u;
    if (u.startsWith("/")) u = `https://${baseHost}${u}`;
    if (!/^https?:\/\//i.test(u)) continue;
    const host = hostnameOf(u);
    if (!host) continue;
    if (host.endsWith("bing.com") || host.endsWith("r.bing.com")) continue;
    if (seen.has(u)) continue;
    seen.add(u);
    out.push(u);
  }
  return out;
}

async function searchSiteDirect(host, kind, query, maxLinks) {
  const attemptQueries = [
    query,
    // упрощения: убираем кавычки и “служебные” слова, которые ломают внутренний поиск
    query.replace(/\"/g, "").replace(/\b(coin|mintage|edition|limit|limited)\b/gi, " "),
    query.replace(/\"/g, "").replace(/\b(Royal Mint)\b/gi, " "),
  ]
    .map((s) => normSpace(s))
    .filter(Boolean)
    .slice(0, 3);

  for (const q of attemptQueries) {
    const url = siteSearchUrl(host, q, kind);
    const r = await fetchText(url, 25000);
    if (!r.ok || !r.text) continue;

    // Если сайт явно говорит “ничего не найдено”, пробуем следующий q.
    if (/No Results Found|Nothing Found|Ничего не найдено|ничего не найдено/i.test(r.text)) continue;

    const qTokens = normSpace(q)
      .toLowerCase()
      .split(" ")
      .map((x) => x.replace(/[^a-z0-9£]/g, ""))
      .filter((x) => x && x.length >= 3)
      .filter((x) => !["royal", "mint", "limited", "edition", "limit", "mintage", "coin"].includes(x))
      .slice(0, 8);

    const links = extractLinksFromHtml(r.text, host)
    .map((u) => {
      // иногда в поиске WordPress могут быть мусорные “replytocom”/якоря
      try {
        const uu = new URL(u);
        uu.hash = "";
        uu.searchParams.delete("replytocom");
        return uu.toString();
      } catch {
        return u;
      }
    })
    .filter((u) => hostnameOf(u).endsWith(host))
    .filter((u) => !isOfficial(u));

    // Берём “первые” ссылки, но стараемся избежать повторов /page/ и пагинации.
    const filtered = [];
    const seenPath = new Set();
    for (const u of links) {
      try {
        const uu = new URL(u);
        const p = uu.pathname.replace(/\/+$/, "");
        if (!p || p === "" || p === "/") continue;
        if (/\/page\/\d+$/i.test(p)) continue;
        // Отсекаем очевидные разделы/навигацию (в WP поиске они часто в шапке).
        if (
          [
            "/about",
            "/dealers",
            "/glossary",
            "/books",
            "/charts",
            "/collections",
            "/all-posts",
            "/category",
            "/tag",
          ].some((x) => p === x || p.startsWith(x + "/"))
        ) {
          continue;
        }
        // Сигналы релевантности: год в URL или совпадение токенов запроса.
        const urlLc = u.toLowerCase();
        const hasYear = /\b(19|20)\d{2}\b/.test(urlLc);
        const hasToken = qTokens.length ? qTokens.some((t) => urlLc.includes(t)) : false;
        if (!hasYear && !hasToken) continue;
        if (seenPath.has(p)) continue;
        seenPath.add(p);
        filtered.push(u);
        if (filtered.length >= maxLinks) break;
      } catch {
        continue;
      }
    }
    if (filtered.length) return filtered;
  }

  return [];
}

function extractMintageFromPageText(text) {
  const t = normSpace(text);
  if (!t) return null;

  const patterns = [
    // edition limit / limited edition / issue limit
    /\bedition\s+limit\b[^0-9]{0,40}([0-9][0-9,.\s\u00A0]{0,20})/i,
    /\blimited\s+edition\b[^0-9]{0,40}([0-9][0-9,.\s\u00A0]{0,20})/i,
    /\bissue\s+limit\b[^0-9]{0,40}([0-9][0-9,.\s\u00A0]{0,20})/i,
    // mintage
    /\bmintage\b[^0-9]{0,40}([0-9][0-9,.\s\u00A0]{0,20})/i,
    /\blimited\s+mintage\s+of\b[^0-9]{0,40}([0-9][0-9,.\s\u00A0]{0,20})/i,
    // FR/DE/PL
    /\btirage\b[^0-9]{0,40}([0-9][0-9\s\u00A0]{0,20})/i,
    /\bauflage\b[^0-9]{0,40}([0-9][0-9.\s\u00A0]{0,20})/i,
    /\bnakład\b[^0-9]{0,40}([0-9][0-9.\s\u00A0]{0,20})/i,
    /\bnaklad\b[^0-9]{0,40}([0-9][0-9.\s\u00A0]{0,20})/i,
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
  const title = normSpace(item.title_en || item.title);
  const year = (title.match(/\b(19|20)\d{2}\b/) || [])[0] || "";
  // Базовые ключи (без “200 inches” мусора): вытаскиваем "RNLI", "50p", "piedfort" если есть.
  const tokens = [];
  if (/\bRNLI\b/i.test(title)) tokens.push("RNLI");
  const fv = title.match(/\b(50p|£\d+|5oz|2oz|1oz)\b/i);
  if (fv && fv[0]) tokens.push(fv[0]);
  if (/piedfort/i.test(title)) tokens.push("piedfort");
  if (!tokens.length && title) {
    tokens.push(
      ...title
        .split(" ")
        .map((x) => x.replace(/[^A-Za-z0-9£]/g, ""))
        .filter((x) => x && !/^\d+$/.test(x))
        .slice(0, 6)
    );
  }
  return normSpace([tokens.join(" "), year, "Royal Mint", "coin", "mintage", '"limited edition"', '"edition limit"'].filter(Boolean).join(" "));
}

function computeConsensus(proposals) {
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
      return { verifiedMintage: parseInt(k, 10), supportingHosts: [...hosts].slice(0, 6) };
    }
  }
  return { verifiedMintage: null, supportingHosts: [] };
}

function relevanceTokensForItem(item) {
  const title = normSpace(item.title_en || item.title);
  const tokens = [];
  // acronyms like RNLI
  const acr = title.match(/\b[A-Z]{3,}\b/g) || [];
  tokens.push(...acr.map((x) => x.toLowerCase()));
  // face value markers
  const fv = title.match(/\b(50p|£\d+|sixpence|piedfort|sovereign|penny|two-pound|2oz|5oz|1oz)\b/gi) || [];
  tokens.push(...fv.map((x) => x.toLowerCase()));
  // year
  const year = (title.match(/\b(19|20)\d{2}\b/) || [])[0];
  if (year) tokens.push(year);
  // a few meaningful words
  const stop = new Set(["the", "and", "for", "with", "coin", "silver", "gold", "proof", "uk", "great", "britain", "royal", "mint", "years", "year"]);
  for (const w of title.split(" ")) {
    const t = w.replace(/[^A-Za-z0-9£]/g, "").toLowerCase();
    if (!t || t.length < 5) continue;
    if (stop.has(t)) continue;
    tokens.push(t);
    if (tokens.length >= 10) break;
  }
  return [...new Set(tokens)].slice(0, 10);
}

function anchorsForItem(item) {
  const title = normSpace(item.title_en || item.title || "");
  const out = [];
  const acr = title.match(/\b[A-Z]{3,}\b/g) || [];
  out.push(...acr.map((x) => x.toLowerCase()));
  const year = (title.match(/\b(19|20)\d{2}\b/) || [])[0];
  if (year) out.push(year);
  const denom = title.match(/\b(50p|£\d+|sixpence|piedfort|sovereign|penny|shilling|crown|2oz|5oz|1oz)\b/gi) || [];
  out.push(...denom.map((x) => x.toLowerCase()));
  for (const w of title.split(" ")) {
    const t = w.replace(/[^A-Za-z0-9£]/g, "").toLowerCase();
    if (!t || t.length < 5) continue;
    if (["royal", "mint", "silver", "gold", "proof", "coin", "years", "year", "anniversary", "birth", "queen", "kingdom"].includes(t)) continue;
    out.push(t);
    if (out.length >= 12) break;
  }
  return [...new Set(out)].slice(0, 12);
}

function relevanceForPage(item, url, html) {
  const u = String(url || "").toLowerCase();
  const t = normSpace(String(html || "")).toLowerCase();
  const anchors = anchorsForItem(item);
  if (!anchors.length) return { ok: true, matched: [] };
  const matched = anchors.filter((a) => u.includes(a) || t.includes(a));
  const acronyms = anchors.filter((a) => /^[a-z]{3,}$/.test(a) && /^[A-Z]{3,}$/.test(a.toUpperCase()));
  const hasAcronym = acronyms.some((a) => matched.includes(a));
  const ok = matched.length >= 2 || (matched.length >= 1 && hasAcronym);
  return { ok, matched: matched.slice(0, 8) };
}

function pageLooksRelevant(item, html) {
  const t = String(html || "").toLowerCase();
  if (!t) return false;
  const title = normSpace(item.title_en || item.title);
  const strong = [];
  const acr = title.match(/\b[A-Z]{3,}\b/g) || [];
  strong.push(...acr.map((x) => x.toLowerCase()));
  const year = (title.match(/\b(19|20)\d{2}\b/) || [])[0];
  if (year) strong.push(year);
  const fv = title.match(/\b(50p|£\d+|sixpence|piedfort|sovereign|penny|two-pound|2oz|5oz|1oz)\b/gi) || [];
  strong.push(...fv.map((x) => x.toLowerCase()));
  const strongUniq = [...new Set(strong)].filter(Boolean);
  if (strongUniq.length) return strongUniq.some((x) => t.includes(x));

  const tokens = relevanceTokensForItem(item);
  if (!tokens.length) return true;
  return tokens.some((x) => t.includes(x));
}

function urlLooksRelevant(item, url) {
  const u = String(url || "").toLowerCase();
  if (!u) return false;
  const title = normSpace(item.title_en || item.title);
  const acr = title.match(/\b[A-Z]{3,}\b/g) || [];
  const acrLc = acr.map((x) => x.toLowerCase());
  if (acrLc.length) return acrLc.some((x) => u.includes(x));
  const year = (title.match(/\b(19|20)\d{2}\b/) || [])[0];
  if (year && u.includes(year)) return true;
  const fv = title.match(/\b(50p|£\d+|sixpence|piedfort|sovereign)\b/gi) || [];
  const fvLc = fv.map((x) => x.toLowerCase());
  if (fvLc.length) return fvLc.some((x) => u.includes(x));
  return true;
}

async function runOne(item, opts) {
  const coinId = parseInt(item.id, 10);
  const baseQuery = buildQuery(item);
  const links = [];

  if (opts.directSites) {
    const fullTitle = normSpace(item.title_en || item.title || "");
    const fullTitleQuery = normSpace([`"${fullTitle}"`, "Royal Mint coin", '"limited edition"', '"edition limit"', "mintage"].join(" "));

    const compactTitle = normSpace(
      fullTitle
        .replace(/[^A-Za-z0-9£\s-]/g, " ")
        .replace(/\b(UK|The|of|the|and|Coin)\b/gi, " ")
    );
    const compactTitleQuery = normSpace([`"${compactTitle}"`, "Royal Mint", '"limited edition"', '"edition limit"', "mintage"].join(" "));

    const directQueryVariants = [fullTitleQuery, compactTitleQuery, baseQuery].filter(Boolean);

    // Режим без поисковиков: используем встроенный поиск конкретных сайтов.
    for (const s of DIRECT_SEARCH_SITES) {
      for (const q of directQueryVariants) {
        const found = await searchSiteDirect(s.host, s.kind, q, 2);
        for (const u of found) links.push(u);
        if (links.length >= opts.maxLinks) break;
        await sleep(120);
      }
      if (links.length >= opts.maxLinks) break;
      await sleep(180);
    }
  } else {
    // Поиск через Bing (может требовать ручной challenge в headful).
    for (const site of SEARCH_SITES) {
      const q = `site:${site} ${baseQuery}`;
      const found = await searchBingWithPlaywright(opts.browser, q, 3);
      for (const u of found) {
        if (!isOfficial(u)) links.push(u);
      }
      if (links.length >= opts.maxLinks) break;
      await sleep(120);
    }

    if (!links.length) {
      const found = await searchBingWithPlaywright(opts.browser, baseQuery, opts.maxLinks);
      for (const u of found) {
        if (!isOfficial(u)) links.push(u);
      }
    }
  }

  const proposals = [];
  for (const u of links.slice(0, opts.maxLinks)) {
    if (!urlLooksRelevant(item, u)) continue;
    const host = hostnameOf(u);
    if (!host) continue;
    // Сильно режем нагрузку: не берем кучи ссылок с одного домена.
    if (proposals.some((p) => p.host === host)) continue;

    const page = await fetchText(u, 25000);
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

    // Достаточно 3 источников для одной монеты.
    if (proposals.length >= 3) break;
    await sleep(250);
  }

  const { verifiedMintage, supportingHosts } = computeConsensus(proposals);
  const status = verifiedMintage != null ? "ready_for_review" : proposals.length ? "needs_second_source" : "pending";

  return {
    coinId,
    title: item.title,
    source_url: item.source_url,
    query: baseQuery,
    proposals,
    verifiedMintage,
    verifiedMintageDisplay:
      verifiedMintage != null
        ? `${verifiedMintage.toLocaleString("en-US")} (вторичные источники: ${supportingHosts.join(", ")})`
        : null,
    status,
    verificationNotes:
      verifiedMintage != null
        ? "Совпадение цифры минимум на 2 разных доменах."
        : proposals.length
          ? "Есть кандидаты, но нет совпадения на 2 доменах."
          : "Не найдено числового тиража в первых результатах поиска.",
  };
}

async function main() {
  const limit = parseArgInt("--limit", null);
  const concurrency = parseArgInt("--concurrency", 3);
  const maxLinks = parseArgInt("--max-links", 8);
  const headful = hasFlag("--headful");
  const checkpointEvery = parseArgInt("--checkpoint-every", 10);
  const outPathArg = parseArgString("--out", null);
  const outTimestamped = hasFlag("--out-timestamp");
  const directSites = hasFlag("--direct-sites");
  const onlyFromReports = parseArgStrings("--only-from-report");

  const gap = JSON.parse(fs.readFileSync(EXPORT_GAP, "utf8"));
  const cache = JSON.parse(fs.readFileSync(RM_CACHE, "utf8"));
  const cachedIds = new Set(Object.keys(cache.items || {}));

  const rm = (gap.items || [])
    .filter((x) => x.mint === "The Royal Mint")
    .filter((x) => cachedIds.has(String(x.id)));

  let cohort = limit ? rm.slice(0, limit) : rm;
  if (onlyFromReports.length) {
    const ids = new Set();
    for (const rp of onlyFromReports) {
      const abs = path.isAbsolute(rp) ? rp : path.join(ROOT, rp);
      if (!fs.existsSync(abs)) continue;
      try {
        const data = JSON.parse(fs.readFileSync(abs, "utf8"));
        for (const it of data.items || []) {
          if (it && (it.status === "needs_second_source" || (it.proposals && it.proposals.length))) {
            ids.add(String(it.coinId || it.id));
          }
        }
      } catch {
        /* ignore bad file */
      }
    }
    if (ids.size) cohort = cohort.filter((x) => ids.has(String(x.id)));
  }

  const outPath = outPathArg
    ? path.isAbsolute(outPathArg)
      ? outPathArg
      : path.join(ROOT, outPathArg)
    : outTimestamped
      ? path.join(ROOT, "reports", `royal-mint-external-mintage-research.${tsCompact()}.json`)
      : OUT_DEFAULT;

  const out = {
    generatedAt: new Date().toISOString(),
    schemaVersion: 1,
    definition:
      "Royal Mint: внешний поиск тиражей в неофициальных источниках. proposals: до 3 источников/доменов. verifiedMintage: если одно число встречается на >=2 доменах. В БД не пишет.",
    input: {
      exportGapJson: EXPORT_GAP,
      rmNoMintageCache: RM_CACHE,
      totalRoyalMintInExportGap: rm.length,
      totalInRun: cohort.length,
      concurrency,
      maxLinks,
      headful,
      checkpointEvery,
      outPath,
      directSites,
    },
    summary: {
      withAnyProposals: 0,
      withVerifiedMintage: 0,
      failed: 0,
    },
    items: [],
  };

  let idx = 0;
  const browser = directSites ? null : await chromium.launch({ headless: !headful });
  let processed = 0;

  function checkpoint() {
    // summary уже поддерживаем инкрементально; просто пишем файл
    safeWriteJson(outPath, out);
  }

  async function worker() {
    while (true) {
      const i = idx++;
      if (i >= cohort.length) return;
      const item = cohort[i];
      process.stdout.write(`\r[RM web ${i + 1}/${cohort.length}] id ${item.id}   `);
      try {
        const r = await runOne(item, { maxLinks, browser, directSites });
        if (r.proposals && r.proposals.length) out.summary.withAnyProposals++;
        if (r.verifiedMintage != null) out.summary.withVerifiedMintage++;
        out.items.push(r);
      } catch (e) {
        out.summary.failed++;
        out.items.push({
          coinId: parseInt(item.id, 10),
          title: item.title,
          source_url: item.source_url,
          status: "pending",
          proposals: [],
          verifiedMintage: null,
          verificationNotes: `error: ${String(e.message || e)}`,
        });
      }
      processed++;
      if (checkpointEvery && processed % checkpointEvery === 0) checkpoint();
      await sleep(350);
    }
  }

  const n = Math.max(1, Math.min(6, concurrency));
  await Promise.all(Array.from({ length: n }, () => worker()));
  process.stdout.write("\n");
  if (browser) await browser.close().catch(() => {});

  checkpoint();
  console.log("Готово:", outPath);
  console.log("Итог:", out.summary);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

