/**
 * Отчёт: сколько и каких монет «нет тиража» в смысле coinNeedsMintageResearch
 * (см. scripts/parsing-mintage-constants.js, docs/PARSING-MINTAGE.md):
 *   нет числового mintage и (пустой mintage_display или текст «Тираж не указан»).
 *
 * Опционально — запрос страницы source_url (Royal Mint / Perth) и поиск Mintage в HTML.
 *
 * Запуск (из корня omonete-app, нужен DATABASE_URL в .env):
 *   npm run coins:report-missing-mintage
 *   node scripts/report-coins-missing-mintage.js --no-list     — только сводка и JSON, без списка в консоль
 *   node scripts/report-coins-missing-mintage.js --probe
 *   node scripts/report-coins-missing-mintage.js --probe --limit 15
 *
 * Выход:
 *   data/coins-missing-mintage-report.json
 *   консоль: сводка, по странам, построчный список
 */
require("dotenv").config({ path: ".env" });
const mysql = require("mysql2/promise");
const fs = require("fs");
const path = require("path");
const { coinNeedsMintageResearch, MINTAGE_UNKNOWN_DISPLAY } = require("./parsing-mintage-constants.js");

const DATA_DIR = path.join(__dirname, "..", "data");
const OUT_JSON = path.join(DATA_DIR, "coins-missing-mintage-report.json");

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

function getConfig() {
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
  return { host, port: parseInt(port, 10), user, password, database };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Ищем в HTML таблицах спецификаций типичные подписи тиража.
 */
function extractMintageHintsFromHtml(html) {
  if (!html || typeof html !== "string") return { raw: null, patterns: [] };
  const patterns = [
    /<th[^>]*>\s*Mintage\s*<\/th>\s*<td[^>]*>([\s\S]*?)<\/td>/gi,
    /<th[^>]*>\s*Maximum\s+Mintage\s*<\/th>\s*<td[^>]*>([\s\S]*?)<\/td>/gi,
    /<th[^>]*>\s*Limited\s+Edition\s*<\/th>\s*<td[^>]*>([\s\S]*?)<\/td>/gi,
    /"Mintage"\s*:\s*"([^"]+)"/i,
    /"MaximumMintage"\s*:\s*"([^"]+)"/i,
  ];
  const found = [];
  for (const re of patterns) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(html)) !== null) {
      const text = m[1].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
      if (text && text.length < 200) found.push(text);
    }
  }
  const uniq = [...new Set(found)];
  return { raw: uniq[0] || null, all: uniq };
}

async function probeUrl(url) {
  if (!url || !/^https?:\/\//i.test(url)) return { ok: false, error: "no url" };
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": UA, "Accept-Language": "en-GB,en;q=0.9" },
      redirect: "follow",
    });
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
    const html = await res.text();
    const hints = extractMintageHintsFromHtml(html);
    return { ok: true, httpStatus: res.status, pageMintageHint: hints.raw, pageMintageHints: hints.all };
  } catch (e) {
    return { ok: false, error: String(e.message || e) };
  }
}

function rowMatches(row) {
  return coinNeedsMintageResearch({
    mintage: row.mintage,
    mintage_display: row.mintage_display,
  });
}

async function main() {
  const doProbe = process.argv.includes("--probe");
  const noList = process.argv.includes("--no-list");
  const limitIdx = process.argv.indexOf("--limit");
  const probeLimit = limitIdx !== -1 && process.argv[limitIdx + 1] ? parseInt(process.argv[limitIdx + 1], 10) : 80;

  const conn = await mysql.createConnection(getConfig());
  let candidates;
  try {
    const [r] = await conn.execute(
      `SELECT id, title, title_en, country, catalog_number, catalog_suffix,
              mintage, mintage_display, mint, mint_short, source_url, release_date
       FROM coins
       WHERE (mintage IS NULL OR mintage = 0)
       ORDER BY country, mint, id`
    );
    candidates = r;
  } finally {
    await conn.end();
  }

  const rows = candidates.filter(rowMatches);

  const emptyDisplay = rows.filter(
    (x) => !x.mintage_display || String(x.mintage_display).trim() === ""
  ).length;
  const unknownLabel = rows.length - emptyDisplay;

  console.log("=== Монеты без тиража (нужен поиск числа / уточнение) ===");
  console.log("Всего:", rows.length);
  console.log("  — полностью пустой mintage_display:", emptyDisplay);
  console.log("  — в БД стоит «" + MINTAGE_UNKNOWN_DISPLAY + "»:", unknownLabel);

  const byCountry = {};
  const byMint = {};
  for (const row of rows) {
    const c = (row.country && String(row.country).trim()) || "—";
    byCountry[c] = (byCountry[c] || 0) + 1;
    const m = (row.mint && String(row.mint).trim()) || "—";
    byMint[m] = (byMint[m] || 0) + 1;
  }

  const countryLines = Object.entries(byCountry).sort((a, b) => b[1] - a[1]);
  console.log("\nПо странам:");
  for (const [c, n] of countryLines) {
    console.log(`  ${n}\t${c}`);
  }

  const mintLines = Object.entries(byMint).sort((a, b) => b[1] - a[1]);
  console.log("\nПо монетному двору (топ 25):");
  mintLines.slice(0, 25).forEach(([m, n]) => console.log(`  ${n}\t${m}`));
  if (mintLines.length > 25) console.log(`  … всего дворов в отчёте: ${mintLines.length}`);

  if (!noList && rows.length > 0) {
    console.log("\nСписок (id | каталог | страна | название):");
    for (const row of rows) {
      const id = String(row.id);
      const cat = (row.catalog_number && String(row.catalog_number).trim()) || "—";
      const c = (row.country && String(row.country).trim()) || "—";
      const t = (row.title && String(row.title).trim()) || (row.title_en && String(row.title_en).trim()) || "—";
      const short = t.length > 90 ? t.slice(0, 87) + "…" : t;
      console.log(`${id}\t${cat}\t${c}\t${short}`);
    }
  } else if (noList) {
    console.log("\n(построчный список отключён флагом --no-list; см. JSON)");
  }

  const withUrl = rows.filter((x) => x.source_url && String(x.source_url).trim().startsWith("http"));
  console.log("\nС заполненным source_url:", withUrl.length);

  let probed = 0;
  const enriched = [];

  for (const row of rows) {
    const item = { ...row };
    const url = row.source_url && String(row.source_url).trim();

    if (doProbe && url && /^https?:\/\//i.test(url)) {
      if (probed >= probeLimit) {
        item.pageProbe = { skipped: true, reason: "достигнут --limit" };
      } else {
        const host = (() => {
          try {
            return new URL(url).hostname;
          } catch {
            return "";
          }
        })();
        if (/royalmint\.com|perthmint\.com/i.test(host)) {
          process.stdout.write(`  probe ${row.id} ${host}… `);
          const p = await probeUrl(url);
          probed++;
          item.pageProbe = p;
          console.log(p.ok ? (p.pageMintageHint || "(mintage в HTML не найден)") : p.error);
          await sleep(400);
        } else {
          item.pageProbe = { skipped: true, reason: "не Royal Mint / Perth (нет типового HTML)" };
        }
      }
    }

    enriched.push(item);
  }

  if (doProbe && withUrl.length > probeLimit) {
    console.log("\nОграничение --limit:", probeLimit, "— остальные строки без HTTP-запроса.");
  }

  const summary = {
    generatedAt: new Date().toISOString(),
    criteria:
      "coinNeedsMintageResearch: нет числового mintage и (пустой mintage_display или «Тираж не указан»). См. parsing-mintage-constants.js",
    total: enriched.length,
    emptyMintageDisplay: emptyDisplay,
    unknownDisplayLabel: unknownLabel,
    byCountry: Object.fromEntries(countryLines),
    byMint: Object.fromEntries(mintLines),
    withSourceUrl: withUrl.length,
    probedHttp: doProbe ? probed : 0,
    foundHintOnPage: enriched.filter((x) => x.pageProbe && x.pageProbe.pageMintageHint).length,
    rows: enriched,
  };

  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(OUT_JSON, JSON.stringify(summary, null, 2), "utf8");
  console.log("\nФайл отчёта:", OUT_JSON);
  console.log(
    "Подсказка с страницы (Mintage в HTML):",
    summary.foundHintOnPage,
    "из",
    doProbe ? probed : 0,
    "запросов"
  );
  console.log("\nДальше: вручную обновить coins.mintage / mintage_display или переспарсить (royal-mint:fetch-test, perth:fetch).");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
