/**
 * Партия 3: следующие N монет с пустыми proposals (по порядку в очереди).
 * Те же эвристики PDP, что и партия 2: Maximum Coin Mintage, Limited Edition, LimitedEditionPresentation.
 * Подписи источника зависят от хоста (Royal Mint / Perth Mint / hostname).
 *
 *   node scripts/merge-secondary-mintage-research-batch3.js              — до 100 с пустыми proposals и без «Партия 3:» в notes (чтобы не дублировать прогон)
 *   node scripts/merge-secondary-mintage-research-batch3.js --limit 50
 *   node scripts/merge-secondary-mintage-research-batch3.js --redo    — повторить последнюю партию 3 (по researchBatch3Ids)
 */
const fs = require("fs");
const path = require("path");

const QUEUE = path.join(__dirname, "..", "data", "secondary-mintage-research-queue.json");
const BATCH_TAG = "Партия 3:";

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchHtml(url) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 32000);
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": UA, "Accept-Language": "en-GB,en;q=0.9" },
      redirect: "follow",
      signal: ctrl.signal,
    });
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}`, html: "" };
    return { ok: true, html: await res.text() };
  } catch (e) {
    return { ok: false, error: String(e.message || e), html: "" };
  } finally {
    clearTimeout(t);
  }
}

function brandFromUrl(url) {
  try {
    const h = new URL(url).hostname.replace(/^www\./, "");
    if (h.endsWith("royalmint.com")) return "The Royal Mint";
    if (h.endsWith("perthmint.com")) return "Perth Mint";
    return h.replace(/\..*$/, "") || "Product page";
  } catch {
    return "Product page";
  }
}

function firstIntFromLabel(html, label) {
  const h = html.replace(/&quot;/g, '"').replace(/&#x27;/g, "'");
  const esc = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`"Label":"${esc}","Value":"([0-9][0-9,]*)"`, "g");
  const m = re.exec(h);
  if (!m) return null;
  const n = parseInt(m[1].replace(/,/g, ""), 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function intFromTableAfterTh(html, thText) {
  const esc = thText.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(
    `<th>\\s*${esc}\\s*</th>\\s*<td>\\s*([0-9][0-9,\\s]*)\\s*</td>`,
    "i"
  );
  const m = html.match(re);
  if (!m) return null;
  const n = parseInt(m[1].replace(/[\s,]/g, ""), 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function limitedEditionPresentation(html) {
  const h = html.replace(/&quot;/g, '"');
  const m = h.match(/"LimitedEditionPresentation"\s*:\s*([0-9]+)/);
  if (!m) return null;
  const n = parseInt(m[1], 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function buildProposalsFromHtml(html, pageUrl) {
  const brand = brandFromUrl(pageUrl);
  const proposals = [];
  let maxN = firstIntFromLabel(html, "Maximum Coin Mintage");
  let limN = firstIntFromLabel(html, "Limited Edition");
  if (maxN == null) maxN = intFromTableAfterTh(html, "Maximum Coin Mintage");
  if (limN == null) limN = intFromTableAfterTh(html, "Limited Edition");
  if (limN == null) limN = limitedEditionPresentation(html);
  if (maxN != null) {
    proposals.push({
      mintage: maxN,
      sourceName: `${brand} (PDP: Maximum Coin Mintage)`,
      sourceUrl: pageUrl,
    });
  }
  if (limN != null && limN !== maxN) {
    proposals.push({
      mintage: limN,
      sourceName: `${brand} (PDP: Limited Edition)`,
      sourceUrl: pageUrl,
    });
  }
  return proposals;
}

function hasUnlimitedHint(html) {
  return /unlimited\s+mintage|maximum\s+coin\s+mintage.*unlimited/i.test(html.replace(/&quot;/g, '"'));
}

function simplerRemovePart3(s) {
  if (!s || !s.includes(BATCH_TAG)) return s || "";
  let out = s;
  while (out.includes(BATCH_TAG)) {
    const i = out.indexOf(BATCH_TAG);
    const before = out.slice(0, i).trimEnd();
    const after = out.slice(i + BATCH_TAG.length);
    const j = after.search(/Партия [12]:/);
    const tail = j === -1 ? "" : after.slice(j).trimStart();
    out = [before, tail].filter(Boolean).join(" ").trim();
  }
  return out;
}

async function main() {
  const redo = process.argv.includes("--redo");
  const limIdx = process.argv.indexOf("--limit");
  const limit = limIdx !== -1 && process.argv[limIdx + 1] ? parseInt(process.argv[limIdx + 1], 10) : 100;

  const doc = JSON.parse(fs.readFileSync(QUEUE, "utf8"));
  const byId = Object.fromEntries(doc.items.map((x) => [x.coinId, x]));

  let batchEntries;
  if (redo && doc.summary?.researchBatch3Ids?.length) {
    batchEntries = doc.summary.researchBatch3Ids.map((id) => {
      const it = byId[id];
      return [id, it && it.source_url ? String(it.source_url).trim() : ""];
    });
  } else {
    const empty = doc.items.filter(
      (it) =>
        (!it.proposals || it.proposals.length === 0) &&
        !String(it.verificationNotes || "").includes(BATCH_TAG)
    );
    batchEntries = empty.slice(0, limit).map((it) => [it.coinId, String(it.source_url || "").trim()]);
  }

  const processed = [];
  const failed = [];

  for (const [coinId, url] of batchEntries) {
    const it = byId[coinId];
    if (!it) {
      failed.push({ coinId, error: "нет в очереди" });
      continue;
    }
    if (!redo && it.proposals && it.proposals.length > 0) {
      console.warn("skip (уже есть proposals)", coinId);
      continue;
    }
    if (redo) {
      it.verificationNotes = simplerRemovePart3(String(it.verificationNotes || ""));
      it.proposals = [];
    }

    if (!url || !/^https?:\/\//i.test(url)) {
      it.verificationNotes =
        (it.verificationNotes ? it.verificationNotes + " " : "") +
        `${BATCH_TAG} нет source_url — только ручной поиск.`;
      it.status = "pending";
      processed.push(coinId);
      console.log("skip", coinId, "no url");
      continue;
    }

    process.stdout.write(`fetch ${coinId}… `);
    const { ok, html, error } = await fetchHtml(url);
    if (!ok || !html) {
      console.log("FAIL", error);
      failed.push({ coinId, error: error || "no html" });
      it.verificationNotes =
        (it.verificationNotes ? it.verificationNotes + " " : "") +
        `${BATCH_TAG} не удалось загрузить PDP (${error || "no html"}).`;
      it.status = "pending";
      processed.push(coinId);
      await sleep(450);
      continue;
    }

    const proposals = buildProposalsFromHtml(html, url);
    let notes = "";

    if (proposals.length === 0) {
      if (hasUnlimitedHint(html)) {
        notes = `${BATCH_TAG} на PDP указан безлимитный / нет числа в типовых полях — Numista или дилер.`;
      } else {
        notes = `${BATCH_TAG} Maximum/Limited на PDP не найдены — другая вёрстка или архивная страница.`;
      }
    } else if (proposals.length === 2) {
      notes = `${BATCH_TAG} два значения (maximum vs limited edition) — выберите для каталога.`;
      it.status = "pending";
    } else {
      notes = `${BATCH_TAG} одно число с PDP; при желании второй источник вручную.`;
      it.status = "pending";
    }

    it.proposals = proposals;
    if (notes) it.verificationNotes = (it.verificationNotes ? it.verificationNotes + " " : "") + notes;

    console.log("OK", proposals.map((p) => p.mintage).join("+") || "(нет числа)");
    processed.push(coinId);
    await sleep(450);
  }

  doc.summary = doc.summary || {};
  doc.summary.researchBatch3At = new Date().toISOString();
  doc.summary.researchBatch3Limit = limit;
  doc.summary.researchBatch3Ids = processed;
  doc.summary.researchBatch3Failed = failed;
  doc.summary.researchBatch3Note = `Партия 3: до ${limit} монет (пустые proposals, без прежней «Партия 3:») — парсинг PDP (RM/Perth и др.).`;

  fs.writeFileSync(QUEUE, JSON.stringify(doc, null, 2), "utf8");
  console.log("\nЗаписано:", QUEUE);
  console.log("Обработано:", processed.length, "| ошибок загрузки:", failed.length);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
