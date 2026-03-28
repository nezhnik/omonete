/**
 * Вторичные источники: НЕ запрашиваем официальные сайты (Royal Mint, Perth, PAMP, Germania, Münze Österreich и т.д.).
 *
 * Для всех монет с пустыми proposals:
 *   - пересобирает searchUrls под поиск по title_en + подсказка из catalog_number (UK, PAMP, Germania…);
 *   - дописывает verificationNotes (тег «Партия В2»).
 *
 * Опционально (если не бот-блок): SECONDARY_TRY_DDG=1
 *   - DuckDuckGo Lite site:numista.com → id → en.numista.com/{id} → «issue limit of N» + год из названия.
 *
 *   node scripts/merge-secondary-mintage-secondary-batch.js
 *   SECONDARY_TRY_DDG=1 node scripts/merge-secondary-mintage-secondary-batch.js
 *   node scripts/merge-secondary-mintage-secondary-batch.js --limit 30
 *   node scripts/merge-secondary-mintage-secondary-batch.js --redo   — снять старые «Партия В2» и обработать снова
 */
const fs = require("fs");
const path = require("path");

const QUEUE = path.join(__dirname, "..", "data", "secondary-mintage-research-queue.json");
const BATCH_TAG = "Партия В2:";
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

const OFFICIAL_HOST = /\.(royalmint\.com|perthmint\.com|pamp\.com|germaniamint\.com|muenzeoesterreich\.at)\b/i;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function catalogHint(cat) {
  const c = String(cat || "");
  if (/^GB-ROYAL/i.test(c)) return "United Kingdom ";
  if (/^CH-PAMP/i.test(c)) return "PAMP Niue ";
  if (/^DE-GERMANIA|^PL-GERMANIA/i.test(c)) return "Germania Mint ";
  if (/^AU-PERTH/i.test(c)) return "Australia Perth Mint ";
  if (/^PL-MENNICA/i.test(c)) return "Poland Mennica ";
  return "";
}

function buildSecondarySearchUrls(item) {
  const en = String(item.title_en || item.title || "").trim();
  const qBase = (catalogHint(item.catalog_number) + en).replace(/\s+/g, " ").trim().slice(0, 160);
  const enc = (s) => encodeURIComponent(s);
  return {
    numista: `https://en.numista.com/catalogue/index.php?q=${enc(qBase)}`,
    googleNumista: `https://www.google.com/search?q=${enc(`site:numista.com ${qBase}`)}`,
    googleColnect: `https://www.google.com/search?q=${enc(`site:colnect.com ${qBase}`)}`,
    googleDealerMintage: `https://www.google.com/search?q=${enc(`${qBase} mintage limited edition`)}`,
    googleGeneral: `https://www.google.com/search?q=${enc(`${qBase} coin mintage`)}`,
  };
}

async function fetchText(url) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 28000);
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": UA, "Accept-Language": "en-GB,en;q=0.9" },
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

function yearHintFromTitle(title) {
  const m = String(title || "").match(/\b(20[0-2]\d)\b/);
  return m ? parseInt(m[1], 10) : null;
}

function extractIssueLimitsByYear(html) {
  const re = /The (20\d{2})[^]{0,150}?issue limit of ([0-9,]+)/gi;
  const out = [];
  let m;
  while ((m = re.exec(html))) {
    out.push({ year: parseInt(m[1], 10), n: parseInt(m[2].replace(/,/g, ""), 10) });
  }
  return out;
}

function pickMintage(pairs, yearHint) {
  if (!pairs.length) return null;
  if (yearHint != null) {
    const hit = pairs.find((p) => p.year === yearHint);
    if (hit) return hit.n;
  }
  if (pairs.length === 1) return pairs[0].n;
  return null;
}

function extractNumistaIdsFromDdg(html) {
  const ids = new Set();
  const re = /numista\.com\/(\d{5,8})(?:[\s"'/?]|$)/gi;
  let m;
  while ((m = re.exec(html))) {
    const id = m[1];
    if (id.length >= 5 && id.length <= 8) ids.add(id);
  }
  return [...ids];
}

function stripPartV2Notes(s) {
  if (!s || !s.includes(BATCH_TAG)) return (s || "").trim();
  const parts = s.split(BATCH_TAG);
  const head = parts[0].trimEnd();
  const rest = parts.slice(1).join(BATCH_TAG);
  const j = rest.search(/\bПартия /);
  const tail = j === -1 ? "" : rest.slice(j).trimStart();
  return [head, tail].filter(Boolean).join(" ").trim();
}

function pageRoughlyMatches(title, html) {
  const words = String(title || "")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 3);
  const hay = html.slice(0, 12000).toLowerCase();
  if (words.length === 0) return true;
  const hit = words.filter((w) => hay.includes(w)).length;
  return hit / words.length >= 0.2;
}

async function tryNumistaViaDdg(item) {
  const en = String(item.title_en || item.title || "").trim();
  const q = `site:numista.com ${catalogHint(item.catalog_number)}${en}`.slice(0, 130);
  const url = `https://lite.duckduckgo.com/lite/?q=${encodeURIComponent(q)}`;
  const { ok, text, error } = await fetchText(url);
  if (!ok || !text) return { error: error || "DDG fail" };
  if (text.includes("challenge-form") || text.includes("anomaly.js")) {
    return { error: "DDG challenge/bot — запустите с домашнего IP или вручную по searchUrls" };
  }
  const ids = extractNumistaIdsFromDdg(text).slice(0, 4);
  if (ids.length === 0) return { error: "в выдаче DDG нет id Numista" };

  const y = yearHintFromTitle(en);
  for (const id of ids) {
    const page = await fetchText(`https://en.numista.com/${id}`);
    if (!page.ok || !page.text) continue;
    if (!pageRoughlyMatches(en, page.text)) continue;
    const pairs = extractIssueLimitsByYear(page.text);
    const n = pickMintage(pairs, y);
    if (n != null && n > 0) {
      return {
        proposals: [
          {
            mintage: n,
            sourceName: "Numista (карточка en.numista.com, комментарии «issue limit»; найдено через DDG Lite)",
            sourceUrl: `https://en.numista.com/${id}`,
          },
        ],
      };
    }
    const loose = [...page.text.matchAll(/issue limit of ([0-9,]+)/gi)].map((x) =>
      parseInt(x[1].replace(/,/g, ""), 10)
    );
    const uniq = [...new Set(loose)].filter((x) => x > 0);
    if (uniq.length === 1) {
      return {
        proposals: [
          {
            mintage: uniq[0],
            sourceName: "Numista (issue limit в тексте страницы; DDG Lite)",
            sourceUrl: `https://en.numista.com/${id}`,
          },
        ],
      };
    }
  }
  return { error: "на карточках Numista не выделен один тираж по правилам скрипта" };
}

async function main() {
  const redo = process.argv.includes("--redo");
  const tryDdg = process.env.SECONDARY_TRY_DDG === "1" || process.env.SECONDARY_TRY_DDG === "true";
  const limIdx = process.argv.indexOf("--limit");
  const limit =
    limIdx !== -1 && process.argv[limIdx + 1] ? parseInt(process.argv[limIdx + 1], 10) : null;

  const doc = JSON.parse(fs.readFileSync(QUEUE, "utf8"));
  let cohort = doc.items.filter((it) => !it.proposals || it.proposals.length === 0);
  if (!redo) {
    cohort = cohort.filter((it) => !String(it.verificationNotes || "").includes(BATCH_TAG));
  } else {
    for (const it of cohort) {
      it.verificationNotes = stripPartV2Notes(String(it.verificationNotes || ""));
    }
  }
  if (limit != null) cohort = cohort.slice(0, limit);

  let updated = 0;
  let ddgOk = 0;
  let ddgFail = 0;

  for (const it of cohort) {
    const url = it.source_url && String(it.source_url);
    if (url && OFFICIAL_HOST.test(url)) {
      /* не запрашиваем; только помечаем */
    }

    it.searchUrls = buildSecondarySearchUrls(it);

    let extra = `${BATCH_TAG} официальный PDP не запрашивался. Ссылки поиска обновлены (Numista / Colnect / дилеры).`;
    if (tryDdg) {
      process.stdout.write(`ddg ${it.coinId}… `);
      const r = await tryNumistaViaDdg(it);
      if (r.proposals && r.proposals.length) {
        it.proposals = r.proposals;
        extra += ` Numista (авто): ${r.proposals[0].mintage}. Проверьте совпадение выпуска.`;
        ddgOk++;
        console.log("OK", r.proposals[0].mintage);
      } else {
        ddgFail++;
        extra += ` Авто-DDG: ${r.error || "нет данных"}.`;
        console.log("—", r.error || "?");
      }
      await sleep(1400);
    }

    it.verificationNotes = (it.verificationNotes ? it.verificationNotes + " " : "") + extra;
    if (!it.proposals || it.proposals.length === 0) it.status = "pending";
    updated++;
  }

  doc.summary = doc.summary || {};
  doc.summary.researchSecondaryBatchAt = new Date().toISOString();
  doc.summary.researchSecondaryBatchCount = updated;
  doc.summary.researchSecondaryTryDdg = tryDdg;
  doc.summary.researchSecondaryDdgOk = tryDdg ? ddgOk : undefined;
  doc.summary.researchSecondaryDdgFail = tryDdg ? ddgFail : undefined;
  doc.summary.researchSecondaryNote =
    "Партия В2: без офиц. сайтов; searchUrls под Numista/Colnect/дилеров. DDG→Numista только при SECONDARY_TRY_DDG=1.";

  fs.writeFileSync(QUEUE, JSON.stringify(doc, null, 2), "utf8");
  console.log("\nЗаписано:", QUEUE, "| монет:", updated, tryDdg ? `| DDG OK ${ddgOk} fail ${ddgFail}` : "");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
