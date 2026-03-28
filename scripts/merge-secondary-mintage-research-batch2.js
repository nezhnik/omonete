/**
 * Партия 2: следующие 50 монет из очереди (GB-ROYAL с PDP на royalmint.com).
 * Тянет HTML, вытаскивает из JSON разметки Maximum Coin Mintage и Limited Edition.
 * Два разных числа — два proposal; одно — один; нет данных — только verificationNotes.
 *
 * Не затирает строки, где proposals уже заполнены.
 *   node scripts/merge-secondary-mintage-research-batch2.js --redo
 *     — перезаписать только coinId из этой партии (сбросит старые notes «Партия 2»).
 */
const fs = require("fs");
const path = require("path");

const QUEUE = path.join(__dirname, "..", "data", "secondary-mintage-research-queue.json");

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

const BATCH = [
  [6032, "https://www.royalmint.com/shop/monarch/queen-elizabeth-ii/2023-Lunar-Year-of-the-Rabbit-1kg-Silver-Proof-Trial-Piece"],
  [6033, "https://www.royalmint.com/gifts/2024-baby-silver-penny"],
  [6034, "https://www.royalmint.com/gifts/sixpence/2024-silver-sixpence"],
  [6035, "https://www.royalmint.com/gifts/sixpence/2024-wedding-silver-sixpence"],
  [6036, "https://www.royalmint.com/gifts/2025-baby-silver-penny"],
  [6038, "https://www.royalmint.com/britannia/commemorative/2025-britannia-2oz-silver-proof-coin"],
  [6039, "https://www.royalmint.com/britannia/commemorative/2025-britannia-5oz-silver-proof-coin"],
  [6040, "https://www.royalmint.com/britannia/commemorative/2025-britannia-six-coin-silver-proof-set"],
  [6041, "https://www.royalmint.com/gifts/sixpence/2025-silver-sixpence"],
  [6042, "https://www.royalmint.com/gifts/2026-baby-silver-penny"],
  [6043, "https://www.royalmint.com/britannia/commemorative/2026-britannia-1oz-silver-proof-coin"],
  [6044, "https://www.royalmint.com/britannia/commemorative/2026-britannia-2oz-silver-proof-coin"],
  [6045, "https://www.royalmint.com/gifts/sixpence/2026-silver-sixpence"],
  [6047, "https://www.royalmint.com/shop/limited-editions/concorde/50th-anniversary-of-the-first-flight-of-concorde-silver-set"],
  [6048, "https://www.royalmint.com/shop/limited-editions/dennis-the-menace/75-years-of-dennis-the-menace-2026-50p-silver-proof-colour-coin"],
  [6049, "https://www.royalmint.com/invest/bullion/uk-coin-ranges/world-coins/australian-kangaroo-2024-1oz-silver-bullion-coin"],
  [6050, "https://www.royalmint.com/invest/bullion/bullion-coins/silver-coins/bb26s1c-britannia-2026-1oz-silver-bullion-coin"],
  [6051, "https://www.royalmint.com/six-decades-of-007/bond-films-of-the-1980s/bond-films-of-the-1980s-2024-2oz-silver-proof-coin"],
  [6052, "https://www.royalmint.com/six-decades-of-007/bond-films-of-the-1980s/bond-films-of-the-1980s-2024-5oz-silver-proof-coin"],
  [6053, "https://www.royalmint.com/six-decades-of-007/bond-films-of-the-1990s/bond-films-of-the-1990s-2024-1oz-silver-proof-coin"],
  [6054, "https://www.royalmint.com/six-decades-of-007/bond-films-of-the-1990s/bond-films-of-the-1990s-2024-5oz-silver-proof-coin"],
  [6055, "https://www.royalmint.com/invest/bullion/bullion-coins/silver-coins/britannia-2022-1-oz-silver-bullion-coin"],
  [6074, "https://www.royalmint.com/shop/coin-sets/Britannia-Silver-Set"],
  [6077, "https://www.royalmint.com/invest/bullion/uk-coin-ranges/world-coins/canadian-maple-leaf-2024-1oz-silver-bullion-coin"],
  [6083, "https://www.royalmint.com/invest/bullion/bullion-coins/silver-coins/count-dracula-2025-1oz-silver-bullion-coin"],
  [6087, "https://www.royalmint.com/shop/coin-sets/dame-vera-lynn-1917-half-crown-and-2022-2-pound-silver-proof"],
  [6089, "https://www.royalmint.com/shop/limited-editions/portraits-of-a-queen/the-second-effigy/elizabeth-ii-the-second-effigy-2026-silver-proof-piedfort-coin"],
  [6096, "https://www.royalmint.com/shop/limited-editions/harry-potter/the-patronus/harry-potter-the-patronus-2025-fifty-pence-silver-proof-colour-coin"],
  [6101, "https://www.royalmint.com/invest/bullion/uk-coin-ranges/world-coins/krugerrand-2024-1oz-silver-bullion-coin"],
  [6102, "https://www.royalmint.com/invest/bullion/bullion-coins/silver-coins/legendary-creatures-loch-ness-monster-2026-uk-1oz-silver-bullion-coin"],
  [6104, "https://www.royalmint.com/lunar/year-of-the-horse/lunar-year-of-the-horse-1oz-silver-proof-coin"],
  [6105, "https://www.royalmint.com/lunar/year-of-the-snake/lunar-year-of-the-snake-2025-1oz-silver-proof-coin"],
  [6106, "https://www.royalmint.com/lunar/year-of-the-snake/lunar-year-of-the-snake-2025-5oz-silver-proof-coin"],
  [6108, "https://www.royalmint.com/invest/bullion/bullion-coins/silver-coins/merlin-2025-10oz-bullion-coin"],
  [6109, "https://www.royalmint.com/shop/ancient-historic/trial-of-the-pyx/Myths-and-Legends-Morgan-le-Fay-2023-UK-1oz-Silver-Proof-Coin"],
  [6115, "https://www.royalmint.com/shop/limited-editions/portraits-of-a-queen/the-fifth-effigy/portraits-of-a-queen-elizabeth-the-fifth-effigy-2026-silver-proof-coin"],
  [6118, "https://www.royalmint.com/invest/bullion/bullion-coins/silver-coins/2oz-silver-bullion-coins/rqp252s--the-royal-tudor-beasts-2025-queens-panther-2oz-silver-bullion-coin"],
  [6121, "https://www.royalmint.com/invest/bullion/bullion-coins/silver-coins/2oz-silver-bullion-coins/RTGR252S-The-Royal-Tudor-Beasts-2025-Greyhound-of-Richmond-2oz-Silver-Bullion-Coin"],
  [6122, "https://www.royalmint.com/shop/ancient-historic/trial-of-the-pyx/Star-Wars-TIE-Fighter-2024-UK-50p-Silver-Proof-Colour-oin"],
  [6123, "https://www.royalmint.com/star-wars/vehicles/x-wing/star-wars-x-wing-2024-5oz-silver-proof-coin"],
  [6127, "https://www.royalmint.com/shop/limited-editions/stories-of-the-second-world-war/stories-of-the-second-world-war-2025-50p-silver-proof-coin"],
  [6128, "https://www.royalmint.com/shop/limited-editions/team-gb-2024/team-gb-and-paralympicsgb-2024-50p-silver-proof-colour-coin"],
  [6129, "https://www.royalmint.com/shop/ancient-historic/trial-of-the-pyx/The-Waterloo-Medal-Allied-Leaders-2024-UK-5oz-Silver-Proof-Coin"],
  [6133, "https://www.royalmint.com/the-royal-tudor-beasts/greyhound-of-richmond/the-greyhound-of-richmond-2025-1oz-silver-proof-coin"],
  [6134, "https://www.royalmint.com/the-royal-tudor-beasts/greyhound-of-richmond/the-greyhound-of-richmond-2025-2oz-silver-proof-coin"],
  [6145, "https://www.royalmint.com/invest/bullion/bullion-coins/silver-coins/the-lion-and-the-eagle-2026-1-2oz-silver-bullion-coin"],
  [6146, "https://www.royalmint.com/invest/bullion/bullion-coins/gold-coins/the-lion-and-the-eagle-2026-1oz-gold-bullion-coin"],
  [6147, "https://www.royalmint.com/invest/bullion/bullion-coins/silver-coins/the-lion-and-the-eagle-2026-1oz-silver-bullion-coin"],
  [6151, "https://www.royalmint.com/great-engravers/the-william-iv-crown/the-merlen-shield-silver-two-coin-set"],
  [6154, "https://www.royalmint.com/the-royal-tudor-beasts/the-queens-panther/the-queens-panther-2025-10oz-silver-proof-coin"],
];

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

function firstIntFromLabel(html, label) {
  const h = html.replace(/&quot;/g, '"').replace(/&#x27;/g, "'");
  const esc = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`"Label":"${esc}","Value":"([0-9][0-9,]*)"`, "g");
  const m = re.exec(h);
  if (!m) return null;
  const n = parseInt(m[1].replace(/,/g, ""), 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** Таблица на PDP: <th>…</th> … <td>1,206</td> */
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

/** В data-product-settings / stockSummary на PDP */
function limitedEditionPresentation(html) {
  const h = html.replace(/&quot;/g, '"');
  const m = h.match(/"LimitedEditionPresentation"\s*:\s*([0-9]+)/);
  if (!m) return null;
  const n = parseInt(m[1], 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function buildProposalsFromHtml(html, pageUrl) {
  const proposals = [];
  let maxN = firstIntFromLabel(html, "Maximum Coin Mintage");
  let limN = firstIntFromLabel(html, "Limited Edition");
  if (maxN == null) maxN = intFromTableAfterTh(html, "Maximum Coin Mintage");
  if (limN == null) limN = intFromTableAfterTh(html, "Limited Edition");
  if (limN == null) limN = limitedEditionPresentation(html);
  if (maxN != null) {
    proposals.push({
      mintage: maxN,
      sourceName: "The Royal Mint (PDP: Maximum Coin Mintage)",
      sourceUrl: pageUrl,
    });
  }
  if (limN != null && limN !== maxN) {
    proposals.push({
      mintage: limN,
      sourceName: "The Royal Mint (PDP: Limited Edition)",
      sourceUrl: pageUrl,
    });
  }
  return proposals;
}

function hasUnlimitedHint(html) {
  return /unlimited\s+mintage|maximum\s+coin\s+mintage.*unlimited/i.test(html.replace(/&quot;/g, '"'));
}

async function main() {
  const redo = process.argv.includes("--redo");
  const batchIds = new Set(BATCH.map((x) => x[0]));

  const doc = JSON.parse(fs.readFileSync(QUEUE, "utf8"));
  const byId = Object.fromEntries(doc.items.map((x) => [x.coinId, x]));

  const processed = [];
  const failed = [];

  for (const [coinId, url] of BATCH) {
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
      if (String(it.verificationNotes || "").includes("Партия 2:")) it.verificationNotes = "";
      it.proposals = [];
    }

    process.stdout.write(`fetch ${coinId}… `);
    const { ok, html, error } = await fetchHtml(url);
    if (!ok || !html) {
      console.log("FAIL", error);
      failed.push({ coinId, error: error || "no html" });
      it.verificationNotes = `Партия 2: не удалось загрузить PDP (${error || "no html"}). Искать вручную.`;
      it.status = "pending";
      processed.push(coinId);
      await sleep(450);
      continue;
    }

    let proposals = buildProposalsFromHtml(html, url);
    let notes = "";

    if (proposals.length === 0) {
      if (hasUnlimitedHint(html)) {
        notes =
          "Партия 2: на PDP указан безлимитный / нет числового тиража в типовых полях — для каталога возможен только текст или внешний каталог.";
      } else {
        notes =
          "Партия 2: в JSON PDP не найдены Maximum Coin Mintage / Limited Edition — проверить страницу вручную (другая разметка).";
      }
    } else if (proposals.length === 2) {
      notes =
        "Два значения с PDP RM (maximum vs limited edition) — выберите, какое вносить в каталог (часто limited edition).";
      it.status = "pending";
    } else {
      notes = "Одно число с PDP RM; при желании добавьте второй источник (Numista / дилер) вручную.";
      it.status = "pending";
    }

    it.proposals = proposals;
    if (notes) it.verificationNotes = (it.verificationNotes ? it.verificationNotes + " " : "") + notes;

    console.log("OK", proposals.map((p) => p.mintage).join("+") || "(нет числа)");
    processed.push(coinId);
    await sleep(450);
  }

  doc.summary = doc.summary || {};
  doc.summary.researchBatch2At = new Date().toISOString();
  doc.summary.researchBatch2Ids = processed;
  doc.summary.researchBatch2Failed = failed;
  doc.summary.researchBatch2Note =
    "Партия 2: 50 GB-ROYAL — данные с PDP royalmint.com (Maximum / Limited). Проверка и второй источник при необходимости вручную.";

  fs.writeFileSync(QUEUE, JSON.stringify(doc, null, 2), "utf8");
  console.log("\nЗаписано:", QUEUE);
  console.log("Обработано:", processed.length, "| ошибок загрузки:", failed.length);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
