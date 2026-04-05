/**
 * Анализ исходных URL картинок Royal Dutch: в data/*.json только локальные webp,
 * реальные media URL сидят в JSON галереи Magento на странице товара (блок mage/gallery/gallery).
 *
 *   node scripts/analyze-royaldutch-gallery-urls.js
 *   node scripts/analyze-royaldutch-gallery-urls.js --limit=100
 *   node scripts/analyze-royaldutch-gallery-urls.js --write=reports/royaldutch-gallery-url-patterns.json --quiet
 *
 * Вывод: статистика по имени файла в URL (без query), слоты 0–4. У части позиций имена — хеш (64 hex),
 * там паттернов нет, только порядок в галерее и/или анализ пикселей.
 */
const fs = require("fs");
const path = require("path");
const https = require("https");

const ROOT = path.join(__dirname, "..");
const DATA_DIR = path.join(ROOT, "data");
const REPORTS = path.join(ROOT, "reports");

function argvNum(name, d) {
  const a = process.argv.find((x) => x.startsWith(`${name}=`));
  if (!a) return d;
  const n = Number(a.split("=")[1]);
  return Number.isFinite(n) ? n : d;
}
function argvOut() {
  const a = process.argv.find((x) => x.startsWith("--write="));
  return a ? a.slice("--write=".length) : null;
}
function argvQuiet() {
  return process.argv.includes("--quiet");
}

function fetchText(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(
      url,
      {
        timeout: 45000,
        headers: {
          "user-agent": "Mozilla/5.0 (compatible; OmoneteGalleryAudit/1.0)",
          accept: "text/html,application/xhtml+xml",
          "accept-encoding": "identity",
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
  });
}

/** Блок основной галереи товара */
function galleryHtmlBlock(html) {
  const key = '"mage/gallery/gallery"';
  const i = html.indexOf(key);
  if (i === -1) return null;
  const j = html.indexOf('"amGalleryConfig"', i);
  return j === -1 ? html.slice(i) : html.slice(i, j);
}

function extractOrderedImgUrls(block) {
  if (!block) return [];
  const re = /"img":"(https?:\\\/\\\/[^"]+)"/g;
  const out = [];
  let m;
  while ((m = re.exec(block)) !== null) {
    const u = JSON.parse(`"${m[1]}"`);
    out.push(u);
  }
  return out;
}

function basenameFromUrl(u) {
  try {
    const noQ = String(u).split("?")[0];
    const seg = noQ.split("/").filter(Boolean).pop() || "";
    return decodeURIComponent(seg).toLowerCase();
  } catch {
    return "";
  }
}

/** Грубая классификация по имени файла (для отчёта, не для продакшена). */
function isHashLikeBasename(base) {
  return /^[a-f0-9]{40,}\.[a-z0-9]+$/i.test(base);
}

function classifyBasename(base) {
  const tags = [];
  if (/vz-kz|vz_kz/.test(base)) tags.push("pair");
  if (/^vz_-_/.test(base) && !tags.includes("pair")) tags.push("prefix_vz");
  if (/^kz_-_/.test(base)) tags.push("prefix_kz");
  if (/omdoos|giftbox|geschenk|luxe_doos|\bdoos\b|_tin_|etui|presentation|cache_/.test(base)) tags.push("box_word");
  if (/munthouder|coincard|coin_card|blister|capsule|houder/.test(base)) tags.push("holder_pack_word");
  if (/zilveren_dukaat|gouden_dukaat/.test(base)) tags.push("series_dukaat_name");
  if (/certificaat|certificate|coa|echtheid/.test(base)) tags.push("cert_word");
  return tags;
}

function listJsonFiles() {
  return fs
    .readdirSync(DATA_DIR)
    .filter((f) => f.startsWith("royaldutch-mint-") && f.endsWith(".json") && !f.includes("listing-products"))
    .map((f) => path.join(DATA_DIR, f))
    .sort();
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function main() {
  const limit = argvNum("--limit", 0);
  const outPath = argvOut();
  const quiet = argvQuiet();
  const files = listJsonFiles();
  const slice = limit > 0 ? files.slice(0, limit) : files;

  const bySlotBasename = {}; // slot -> { base: count }
  const firstTokenHistogram = {};
  const prefixKzAtSlot = { 0: 0, 1: 0, 2: 0 };
  const prefixVzAtSlot = { 0: 0, 1: 0, 2: 0 };
  const omdoosAtSlot = { 0: 0, 1: 0, 2: 0 };
  const kzWithDukaatAt1 = { yes: 0, no: 0 };
  let ok = 0;
  let noGallery = 0;
  let fetchFail = 0;
  let hashLikeSlot0 = 0;
  let semanticSlot0 = 0;
  const samples = [];

  for (let i = 0; i < slice.length; i++) {
    const fp = slice[i];
    let coin;
    try {
      coin = JSON.parse(fs.readFileSync(fp, "utf8")).coin;
    } catch {
      continue;
    }
    const source = coin && coin.source_url;
    if (!source) continue;

    const html = await fetchText(source);
    if (!html) {
      fetchFail++;
      continue;
    }
    const block = galleryHtmlBlock(html);
    if (!block) {
      noGallery++;
      continue;
    }
    const urls = extractOrderedImgUrls(block);
    if (!urls.length) {
      noGallery++;
      continue;
    }
    ok++;

    const basenames = urls.map(basenameFromUrl);
    if (basenames[0]) {
      if (isHashLikeBasename(basenames[0])) hashLikeSlot0++;
      else semanticSlot0++;
    }
    for (let s = 0; s < Math.min(5, basenames.length); s++) {
      const b = basenames[s];
      if (!bySlotBasename[s]) bySlotBasename[s] = {};
      bySlotBasename[s][b] = (bySlotBasename[s][b] || 0) + 1;
    }

    const f0 = basenames[0] || "";
    const tok = f0.split("_")[0] || f0.slice(0, 6);
    firstTokenHistogram[tok] = (firstTokenHistogram[tok] || 0) + 1;

    for (const s of [0, 1, 2]) {
      const b = basenames[s] || "";
      if (/^kz_-_/.test(b)) prefixKzAtSlot[s]++;
      if (/^vz_-_/.test(b) && !/vz-kz/.test(b)) prefixVzAtSlot[s]++;
      if (/omdoos|omdoos_en/.test(b)) omdoosAtSlot[s]++;
    }

    if (basenames[1]) {
      if (/^kz_-_/.test(basenames[1]) && /zilveren_dukaat|gouden_dukaat/.test(basenames[1]))
        kzWithDukaatAt1.yes++;
      else if (/^kz_-_/.test(basenames[1])) kzWithDukaatAt1.no++;
    }

    if (samples.length < 25) {
      samples.push({
        slug: coin.slug,
        source_url: source,
        slides: basenames.slice(0, 7).map((b, idx) => ({ i: idx, base: b, tags: classifyBasename(b) })),
      });
    }

    await sleep(120);
  }

  const report = {
    generatedAt: new Date().toISOString(),
    filesScanned: slice.length,
    galleryOk: ok,
    fetchFail,
    noGalleryOrEmpty: noGallery,
    note:
      "vz_-_ / kz_*: часто voorzijde/keerzijde монеты, но kz_-_zilveren_dukaat_* — короб/бренд серии, не реверс. omdoos*, leeuwendaalder_*_omdoos* — короб. Имена вида 64hex.jpeg — без семантики в URL.",
    hashVersusSemanticFirstSlide: {
      slot0_hashLikeBasename: hashLikeSlot0,
      slot0_descriptiveBasename: semanticSlot0,
    },
    slotTopBasenames: Object.fromEntries(
      Object.entries(bySlotBasename).map(([slot, hist]) => {
        const top = Object.entries(hist)
          .sort((a, b) => b[1] - a[1])
          .slice(0, 12);
        return [slot, Object.fromEntries(top)];
      })
    ),
    firstFilenameTokenHistogram: Object.fromEntries(
      Object.entries(firstTokenHistogram).sort((a, b) => b[1] - a[1]).slice(0, 30)
    ),
    prefixKzCountBySlot012: prefixKzAtSlot,
    prefixVzCountBySlot012: prefixVzAtSlot,
    omdoosSubstringCountBySlot012: omdoosAtSlot,
    slot1isKzAndFilenameContainsDukaatSeries: kzWithDukaatAt1,
    sampleProducts: samples,
  };

  const text = JSON.stringify(report, null, 2) + "\n";

  if (outPath) {
    const abs = path.isAbsolute(outPath) ? outPath : path.join(ROOT, outPath);
    if (!fs.existsSync(path.dirname(abs))) fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, text, "utf8");
    console.error("Wrote", abs);
  }

  if (quiet && outPath) {
    console.error(
      `[rdm-gallery-analyze] scanned=${slice.length} galleryOk=${ok} fetchFail=${fetchFail} noGalleryOrEmpty=${noGallery} slot0_hash=${hashLikeSlot0} slot0_semantic=${semanticSlot0}`
    );
  } else {
    console.log(text);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
