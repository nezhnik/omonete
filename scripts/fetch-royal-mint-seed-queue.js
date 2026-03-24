/**
 * По URL из scripts/royal-mint-seed-urls.txt (в т.ч. вставленный HTML):
 * считает тот же slug/PDP, что fetch-royal-mint-coin-test.js (rewriteShopPdpToInvestBullion),
 * и парсит только отсутствующие JSON или с title «404 PAGE NOT FOUND».
 *
 *   node scripts/fetch-royal-mint-seed-queue.js --dry-run
 *   node scripts/fetch-royal-mint-seed-queue.js --all              — все ссылки из seed
 *   node scripts/fetch-royal-mint-seed-queue.js --limit 5
 *   node scripts/fetch-royal-mint-seed-queue.js --no-images
 *   node scripts/fetch-royal-mint-seed-queue.js --file path/to.txt
 *   node scripts/fetch-royal-mint-seed-queue.js --refresh-images  — перепарсить seed-URL с битыми картинками: нет obv/rev, плейсхолдер, или в raw.classified есть URL, а в coin не сохранилось
 *   node scripts/fetch-royal-mint-seed-queue.js --concurrency 4    — параллельно N процессов (или ROYAL_MINT_FETCH_CONCURRENCY=2)
 *
 * URL с /trial-of-the-pyx/ из seed исключаются (архив Pyx не парсим).
 *
 * Дальше: npm run royal-mint:import → npm run data:export
 */
const fs = require("fs");
const path = require("path");
const { readSeedUrlsFromFile } = require("./royal-mint-seed-url-io.js");
const { runRoyalMintFetchPool } = require("./royal-mint-fetch-pool.js");
const { rewriteShopPdpToInvestBullion, isRoyalMintTrialOfPyxUrl } = require("./royal-mint-listing-collect.js");

const DEFAULT_SEED = path.join(__dirname, "royal-mint-seed-urls.txt");
const DATA_DIR = path.join(__dirname, "..", "data");
const FETCH_SCRIPT = path.join(__dirname, "fetch-royal-mint-coin-test.js");
const root = path.join(__dirname, "..");

function slugFromUrl(pageUrl) {
  const pathname = String(pageUrl).replace(/^https?:\/\/[^/]+/, "").replace(/\?.*$/, "").replace(/\/$/, "");
  const segments = pathname.split("/").filter(Boolean);
  const last = segments[segments.length - 1] || "royal-mint-coin";
  return last
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "") || "royal-mint-coin";
}

function is404Title(t) {
  return /404\s+page\s+not\s+found/i.test(String(t || ""));
}

function isEmptyImg(v) {
  return v == null || String(v).trim() === "";
}

function looksLikePlaceholderPath(v) {
  return /coin-placeholder|placeholder\.png|\/image\/placeholder/i.test(String(v || ""));
}

function parseArgs() {
  const dryRun = process.argv.includes("--dry-run");
  const parseAll = process.argv.includes("--all");
  const noImages = process.argv.includes("--no-images");
  const refreshImages = process.argv.includes("--refresh-images");
  const fi = process.argv.indexOf("--file");
  const li = process.argv.indexOf("--limit");
  const seedFile =
    fi >= 0 && process.argv[fi + 1] ? process.argv[fi + 1] : DEFAULT_SEED;
  const limit = li >= 0 && process.argv[li + 1] ? parseInt(process.argv[li + 1], 10) : 0;
  const ci = process.argv.indexOf("--concurrency");
  let concurrency =
    ci >= 0 && process.argv[ci + 1] ? parseInt(process.argv[ci + 1], 10) : parseInt(process.env.ROYAL_MINT_FETCH_CONCURRENCY || "2", 10);
  if (!Number.isFinite(concurrency) || concurrency < 1) concurrency = 1;
  if (concurrency > 12) concurrency = 12;
  return {
    dryRun,
    parseAll,
    noImages,
    refreshImages,
    seedFile: path.isAbsolute(seedFile) ? seedFile : path.join(process.cwd(), seedFile),
    limit: Number.isFinite(limit) && limit > 0 ? limit : 0,
    concurrency,
  };
}

function classifySeedUrl(seedUrl, refreshImages) {
  const preferSilver = /\bsilver\b|ss360query=silver/i.test(seedUrl);
  const fetchUrl = rewriteShopPdpToInvestBullion(seedUrl, { preferSilver });
  const fileSlug = slugFromUrl(fetchUrl);
  const jsonPath = path.join(DATA_DIR, `royal-mint-${fileSlug}.json`);
  if (!fs.existsSync(jsonPath)) {
    return { seedUrl, fetchUrl, fileSlug, jsonPath, reason: "missing_json" };
  }
  try {
    const j = JSON.parse(fs.readFileSync(jsonPath, "utf8"));
    const title = (j.coin && j.coin.title) || (j.raw && j.raw.title) || "";
    if (is404Title(title)) {
      return { seedUrl, fetchUrl, fileSlug, jsonPath, reason: "404_title" };
    }
    if (refreshImages) {
      const c = j.coin || {};
      const cl = (j.raw && j.raw.classified) || {};
      const obv = c.image_obverse;
      const rev = c.image_reverse;
      const noObv = isEmptyImg(obv);
      const noRev = isEmptyImg(rev);
      const badPath = looksLikePlaceholderPath(obv) || looksLikePlaceholderPath(rev);
      const classifiedObv = cl.obverse != null && String(cl.obverse).trim() !== "";
      const classifiedRev = cl.reverse != null && String(cl.reverse).trim() !== "";
      const classifiedButMissing =
        (classifiedObv && noObv) || (classifiedRev && noRev);

      if (badPath || classifiedButMissing || noObv || noRev) {
        let reason = "incomplete_images";
        if (badPath) reason = "placeholder_or_bad_path";
        else if (classifiedButMissing) reason = "classified_vs_coin_mismatch";
        else if (noObv && noRev) reason = "missing_both_sides";
        else if (noObv) reason = "missing_obverse_image";
        else reason = "missing_reverse_image";
        return { seedUrl, fetchUrl, fileSlug, jsonPath, reason };
      }
    }
  } catch {
    return { seedUrl, fetchUrl, fileSlug, jsonPath, reason: "broken_json" };
  }
  return { seedUrl, fetchUrl, fileSlug, jsonPath, reason: "ok" };
}

async function main() {
  const { dryRun, parseAll, noImages, refreshImages, seedFile, limit, concurrency } = parseArgs();
  const seedsAll = readSeedUrlsFromFile(seedFile);
  const seedsSkippedTrial = seedsAll.filter(isRoyalMintTrialOfPyxUrl);
  const seeds = seedsAll.filter((u) => !isRoyalMintTrialOfPyxUrl(u));
  if (seedsSkippedTrial.length > 0) {
    console.log("Пропуск Trial of the Pyx (не парсим):", seedsSkippedTrial.length, "URL");
  }
  if (seeds.length === 0) {
    console.error("Нет URL в файле:", seedFile);
    process.exit(1);
  }

  const rows = seeds.map((u) => classifySeedUrl(u, refreshImages));
  const ok = rows.filter((r) => r.reason === "ok");
  const needsFix = rows.filter((r) => r.reason !== "ok");

  /** В режиме --all парсим все seed URL (перезапись нормальных тоже). */
  const toRun = parseAll ? seeds.slice() : needsFix.map((r) => r.seedUrl);
  const limited = limit > 0 ? toRun.slice(0, limit) : toRun;

  console.log("Файл seed:", seedFile);
  console.log("URL в seed:", seeds.length);
  console.log("Уже ок (есть JSON, не 404):", ok.length);
  console.log(
    "Нужно обработать:",
    needsFix.length,
    refreshImages ? "(в т.ч. --refresh-images: без image_obverse)" : "(новые / 404 / битый JSON)"
  );
  if (!parseAll) {
    const by = {};
    for (const r of needsFix) by[r.reason] = (by[r.reason] || 0) + 1;
    console.log("  по причинам:", by);
  } else {
    console.log("Режим --all: к парсингу все", seeds.length, "URL из seed");
  }
  console.log(
    dryRun ? "(--dry-run: fetch не запускается)" : "К запуску fetch сейчас:",
    limited.length,
    limit ? `(лимит ${limit})` : "",
    dryRun ? "" : `(параллельность ${concurrency})`
  );

  if (dryRun) {
    const listRows = parseAll ? rows : needsFix;
    for (const r of listRows.slice(0, 200)) {
      console.log(`  [${r.reason}]`, r.fileSlug, "\n    ", r.seedUrl);
    }
    if (listRows.length > 200) console.log("  ... ещё", listRows.length - 200);
    return;
  }

  const { success, fail } = await runRoyalMintFetchPool({
    urls: limited,
    root,
    fetchScript: FETCH_SCRIPT,
    noImages,
    concurrency,
  });

  console.log("\nГотово. Успех:", success, "ошибок:", fail);
  console.log("Дальше: npm run royal-mint:import && npm run data:export");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
