/**
 * Отчёт по 192 URL из seed: где в data/royal-mint-*.json пустые или плейсхолдерные obv/rev.
 * Та же логика, что у fetch-royal-mint-seed-queue.js --refresh-images.
 *
 *   node scripts/report-royal-mint-seed-missing-images.js
 *   node scripts/report-royal-mint-seed-missing-images.js --tsv > data/royal-mint-seed-missing-images.tsv
 *
 * Исправление только этих карточек:
 *   npm run royal-mint:refresh-seed-images
 */
const fs = require("fs");
const path = require("path");
const { readSeedUrlsFromFile } = require("./royal-mint-seed-url-io.js");
const { rewriteShopPdpToInvestBullion } = require("./royal-mint-listing-collect.js");

const DEFAULT_SEED = path.join(__dirname, "royal-mint-seed-urls.txt");
const DATA_DIR = path.join(__dirname, "..", "data");

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

function classify(seedUrl) {
  const preferSilver = /\bsilver\b|ss360query=silver/i.test(seedUrl);
  const fetchUrl = rewriteShopPdpToInvestBullion(seedUrl, { preferSilver });
  const fileSlug = slugFromUrl(fetchUrl);
  const jsonPath = path.join(DATA_DIR, `royal-mint-${fileSlug}.json`);
  if (!fs.existsSync(jsonPath)) {
    return { seedUrl, fetchUrl, fileSlug, jsonPath, reason: "missing_json", obv: "", rev: "" };
  }
  try {
    const j = JSON.parse(fs.readFileSync(jsonPath, "utf8"));
    const title = (j.coin && j.coin.title) || (j.raw && j.raw.title) || "";
    if (is404Title(title)) {
      return { seedUrl, fetchUrl, fileSlug, jsonPath, reason: "404_title", obv: "", rev: "" };
    }
    const c = j.coin || {};
    const cl = (j.raw && j.raw.classified) || {};
    const obv = c.image_obverse;
    const rev = c.image_reverse;
    const noObv = isEmptyImg(obv);
    const noRev = isEmptyImg(rev);
    const badPath = looksLikePlaceholderPath(obv) || looksLikePlaceholderPath(rev);
    const classifiedObv = cl.obverse != null && String(cl.obverse).trim() !== "";
    const classifiedRev = cl.reverse != null && String(cl.reverse).trim() !== "";
    const classifiedButMissing = (classifiedObv && noObv) || (classifiedRev && noRev);

    if (badPath || classifiedButMissing || noObv || noRev) {
      let reason = "incomplete_images";
      if (badPath) reason = "placeholder_or_bad_path";
      else if (classifiedButMissing) reason = "classified_vs_coin_mismatch";
      else if (noObv && noRev) reason = "missing_both_sides";
      else if (noObv) reason = "missing_obverse_image";
      else reason = "missing_reverse_image";
      return {
        seedUrl,
        fetchUrl,
        fileSlug,
        jsonPath,
        reason,
        obv: String(obv || "").slice(0, 120),
        rev: String(rev || "").slice(0, 120),
      };
    }
  } catch (e) {
    return { seedUrl, fetchUrl, fileSlug, jsonPath, reason: "broken_json", obv: "", rev: "", err: e.message };
  }
  return null;
}

function main() {
  const tsv = process.argv.includes("--tsv");
  const seedFile = process.argv.includes("--file")
    ? path.join(process.cwd(), process.argv[process.argv.indexOf("--file") + 1])
    : DEFAULT_SEED;

  const seeds = readSeedUrlsFromFile(seedFile);
  if (seeds.length === 0) {
    console.error("Нет URL в seed");
    process.exit(1);
  }

  const bad = [];
  for (const u of seeds) {
    const r = classify(u);
    if (r) bad.push(r);
  }

  const by = {};
  for (const r of bad) by[r.reason] = (by[r.reason] || 0) + 1;

  if (!tsv) {
    console.log("Seed:", seedFile);
    console.log("Всего URL:", seeds.length);
    console.log("С проблемами картинок/JSON:", bad.length);
    console.log("По причинам:", by);
    console.log("");
    for (const r of bad) {
      console.log(`  [${r.reason}] ${r.fileSlug}`);
      console.log(`    seed:  ${r.seedUrl}`);
      console.log(`    fetch: ${r.fetchUrl}`);
      if (r.obv || r.rev) console.log(`    obv: ${r.obv} | rev: ${r.rev}`);
    }
    console.log("\nПерепарсить только проблемные: npm run royal-mint:refresh-seed-images");
    return;
  }

  console.log(["reason", "file_slug", "seed_url", "fetch_url", "json_path", "image_obverse_snip", "image_reverse_snip"].join("\t"));
  for (const r of bad) {
    console.log(
      [r.reason, r.fileSlug, r.seedUrl, r.fetchUrl, r.jsonPath, r.obv || "", r.rev || ""]
        .map((x) => String(x).replace(/\t/g, " ").replace(/\r?\n/g, " "))
        .join("\t")
    );
  }
}

main();
