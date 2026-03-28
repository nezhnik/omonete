/**
 * Когорта: иностранные монеты без числового mintage и без mintage_display (сейчас ~548).
 *
 * Источники (подтверждение):
 *   1) The Royal Mint — JSON в HTML: "Label":"Maximum Coin Mintage","Value":"NNNN"
 *      + вторая проверка: то же число встречается ≥2 раза в блоках спецификаций (дубликаты в разметке).
 *   2) Слитки PL-MENNICA-GOLD-BAR-* — без HTTP (Cloudflare): осмысленный текст для экспорта
 *      («неограниченный» для инвестиционных слитков — отраслевая норма).
 *
 * Perth Mint / PAMP / Germania — пробуем fetch; при Cloudflare/таймауте строка попадает в отчёт
 * (прогон с вашей машины или с токеном/браузером).
 *
 *   node scripts/backfill-foreign-mintage-empty-cohort.js              — отчёт + сухой прогон
 *   node scripts/backfill-foreign-mintage-empty-cohort.js --apply    — UPDATE в БД
 *   node scripts/backfill-foreign-mintage-empty-cohort.js --limit 50  — лимит строк
 */
require("dotenv").config({ path: ".env" });
const mysql = require("mysql2/promise");
const fs = require("fs");
const path = require("path");

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

const OUT_JSON = path.join(__dirname, "..", "data", "foreign-mintage-empty-cohort-report.json");

function getConfig() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL не задан");
  const m = url.match(/mysql:\/\/([^:]+):([^@]+)@([^:]+):(\d+)\/(.+)/);
  if (!m) throw new Error("Неверный формат DATABASE_URL");
  const [, user, password, host, port, database] = m;
  return { host, port: Number(port), user, password, database };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchText(url, timeoutMs = 28000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": UA, "Accept-Language": "en-GB,en;q=0.9" },
      redirect: "follow",
      signal: ctrl.signal,
    });
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}`, html: "" };
    const html = await res.text();
    return { ok: true, html };
  } catch (e) {
    return { ok: false, error: String(e.message || e), html: "" };
  } finally {
    clearTimeout(t);
  }
}

/** Двойное подтверждение: все значения Maximum Coin Mintage в документе совпадают и встречаются ≥2 раза. */
function extractRoyalMintMintage(html) {
  const h = html.replace(/&quot;/g, '"').replace(/&#x27;/g, "'");
  const re = /"Label":"Maximum Coin Mintage","Value":"([0-9]+)"/g;
  const hits = [...h.matchAll(re)].map((m) => m[1]);
  if (hits.length === 0) return null;
  const uniq = [...new Set(hits)];
  if (uniq.length !== 1) return null;
  const n = parseInt(uniq[0], 10);
  if (!Number.isFinite(n) || n <= 0) return null;
  if (hits.length < 2) return null;
  return { n, confirmations: hits.length, method: "royalmint.coinSpecifications" };
}

function extractGenericTableMintage(html) {
  const patterns = [
    /<th[^>]*>\s*Mintage\s*<\/th>\s*<td[^>]*>([\s\S]*?)<\/td>/gi,
    /<th[^>]*>\s*Maximum\s+Mintage\s*<\/th>\s*<td[^>]*>([\s\S]*?)<\/td>/gi,
  ];
  const found = [];
  for (const re of patterns) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(html)) !== null) {
      const text = m[1].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
      const digits = text.replace(/[^\d]/g, "");
      if (digits) {
        const n = parseInt(digits, 10);
        if (n > 0) found.push({ n, raw: text });
      }
    }
  }
  if (found.length === 0) return null;
  const ns = [...new Set(found.map((x) => x.n))];
  if (ns.length !== 1) return null;
  return { n: ns[0], method: "html.th-td", raw: found[0].raw };
}

function mennicaGoldBarProposal() {
  return {
    mintage: null,
    mintage_display:
      "Неограниченный тираж (инвестиционные золотые слитки; лимит эмиссии не публикуется, категория Mennica Polska gold bars)",
    sources: ["отраслевая практика инвестиционных слитков", "каталожный префикс PL-MENNICA-GOLD-BAR-*"],
  };
}

async function main() {
  const apply = process.argv.includes("--apply");
  const limIdx = process.argv.indexOf("--limit");
  const limit = limIdx !== -1 && process.argv[limIdx + 1] ? parseInt(process.argv[limIdx + 1], 10) : null;

  const conn = await mysql.createConnection(getConfig());
  const [rows] = await conn.execute(
    `SELECT id, title, country, catalog_number, source_url
     FROM coins
     WHERE TRIM(IFNULL(country, '')) NOT LIKE 'Россия%'
       AND (mintage IS NULL OR mintage = 0)
       AND (mintage_display IS NULL OR TRIM(mintage_display) = '')
     ORDER BY id`
  );

  const toProcess = limit ? rows.slice(0, limit) : rows;
  const results = [];
  let updated = 0;

  for (const row of toProcess) {
    const cat = String(row.catalog_number || "");
    const url = row.source_url && String(row.source_url).trim();
    let proposal = null;
    let status = "skip";

    if (/^PL-MENNICA-GOLD-BAR-/i.test(cat)) {
      proposal = mennicaGoldBarProposal();
      status = "mennica-bar-text";
    } else if (url && /royalmint\.com/i.test(url)) {
      await sleep(480);
      const { ok, html, error } = await fetchText(url);
      if (!ok) {
        status = "royalmint-fetch-fail";
        results.push({ id: row.id, title: row.title, url, status, error });
        continue;
      }
      if (/cloudflare|Attention Required/i.test(html) && html.length < 8000) {
        status = "royalmint-cloudflare";
        results.push({ id: row.id, title: row.title, url, status });
        continue;
      }
      const rm = extractRoyalMintMintage(html);
      if (rm) {
        proposal = {
          mintage: rm.n,
          mintage_display: `${rm.n.toLocaleString("en-US")} (The Royal Mint: Maximum Coin Mintage ×${rm.confirmations} в разметке PDP)`,
          sources: [rm.method, `url:${url}`],
        };
        status = "royalmint-json-confirmed";
      } else {
        status = "royalmint-no-mintage-field";
        results.push({ id: row.id, title: row.title, url, status });
        continue;
      }
    } else if (url && /perthmint\.com/i.test(url)) {
      await sleep(500);
      const { ok, html, error } = await fetchText(url);
      if (!ok || (html.length < 8000 && /cloudflare/i.test(html))) {
        status = "perth-blocked-or-fail";
        results.push({ id: row.id, title: row.title, url, status, error: error || "short-html" });
        continue;
      }
      const g = extractGenericTableMintage(html);
      if (g) {
        proposal = {
          mintage: g.n,
          mintage_display: `${g.n.toLocaleString("en-US")} (Perth Mint: ${g.method})`,
          sources: [g.method, url],
        };
        status = "perth-html";
      } else {
        status = "perth-no-mintage";
        results.push({ id: row.id, title: row.title, url, status });
        continue;
      }
    } else if (url && /pamp\.com/i.test(url)) {
      await sleep(500);
      const { ok, html, error } = await fetchText(url, 35000);
      if (!ok || html.length < 5000) {
        status = "pamp-fail-or-blocked";
        results.push({ id: row.id, title: row.title, url, status, error: error || `len=${html.length}` });
        continue;
      }
      const g = extractGenericTableMintage(html);
      if (g) {
        proposal = {
          mintage: g.n,
          mintage_display: `${g.n.toLocaleString("en-US")} (PAMP product page: table/HTML)`,
          sources: [g.method, url],
        };
        status = "pamp-html";
      } else {
        const m = html.match(/limited[^0-9]{0,40}([0-9][0-9,]*)/i);
        if (m) {
          const n = parseInt(m[1].replace(/[^\d]/g, ""), 10);
          if (n > 0) {
            proposal = {
              mintage: n,
              mintage_display: `${n.toLocaleString("en-US")} (PAMP: Limited edition, эвристика текста)`,
              sources: ["pamp.heuristic", url],
            };
            status = "pamp-heuristic";
          }
        }
      }
      if (!proposal) {
        status = "pamp-no-mintage";
        results.push({ id: row.id, title: row.title, url, status });
        continue;
      }
    } else if (url && /germaniamint\.com/i.test(url)) {
      await sleep(450);
      const { ok, html, error } = await fetchText(url);
      if (!ok) {
        status = "germania-fetch-fail";
        results.push({ id: row.id, title: row.title, url, status, error });
        continue;
      }
      const g = extractGenericTableMintage(html);
      if (g) {
        proposal = {
          mintage: g.n,
          mintage_display: `${g.n.toLocaleString("en-US")} (Germania Mint: product HTML)`,
          sources: [g.method, url],
        };
        status = "germania-html";
      } else {
        status = "germania-no-mintage";
        results.push({ id: row.id, title: row.title, url, status });
        continue;
      }
    } else {
      status = "unknown-host-or-no-url";
      results.push({ id: row.id, title: row.title, url: url || null, status });
      continue;
    }

    results.push({
      id: row.id,
      title: row.title,
      url,
      status,
      proposal,
    });

    if (apply && proposal) {
      await conn.execute(`UPDATE coins SET mintage = ?, mintage_display = ? WHERE id = ?`, [
        proposal.mintage != null ? proposal.mintage : null,
        proposal.mintage_display || null,
        row.id,
      ]);
      updated++;
    }
  }

  await conn.end();

  const summary = {
    generatedAt: new Date().toISOString(),
    apply,
    limit: limit ?? null,
    inputRows: toProcess.length,
    updated: apply ? updated : 0,
    byStatus: {},
  };
  for (const r of results) {
    const k = r.status || "?";
    summary.byStatus[k] = (summary.byStatus[k] || 0) + 1;
  }

  fs.writeFileSync(OUT_JSON, JSON.stringify({ summary, results }, null, 2), "utf8");
  console.log("Итог:", summary);
  console.log("Отчёт:", OUT_JSON);
  if (!apply) console.log("\nДля записи в БД добавьте флаг --apply");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
