/**
 * Аудит картинок Royal Mint по seed URL:
 * - где есть/нет obverse/reverse
 * - где obv=rev
 * - где есть только упаковка/box/cert
 * - дубли source_url и image URL
 *
 * Выход:
 * - data/royal-mint-image-audit-report.json
 * - data/royal-mint-image-audit-report.tsv
 */
const fs = require("fs");
const path = require("path");
const { readSeedUrlsFromFile } = require("./royal-mint-seed-url-io.js");
const { rewriteShopPdpToInvestBullion } = require("./royal-mint-listing-collect.js");

const ROOT = path.join(__dirname, "..");
const DATA_DIR = path.join(ROOT, "data");
const SEED_FILE = path.join(__dirname, "royal-mint-seed-urls.txt");

function slugFromUrl(pageUrl) {
  const pathname = String(pageUrl).replace(/^https?:\/\/[^/]+/, "").replace(/\?.*$/, "").replace(/\/$/, "");
  const segments = pathname.split("/").filter(Boolean);
  const last = segments[segments.length - 1] || "royal-mint-coin";
  return last.toLowerCase().replace(/[^a-z0-9-]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "") || "royal-mint-coin";
}

function isEmpty(v) {
  return v == null || String(v).trim() === "";
}

function main() {
  const seeds = readSeedUrlsFromFile(SEED_FILE);
  const rows = [];
  const sourceToSlugs = new Map();
  const imageToSlugs = new Map();

  for (const seedUrl of seeds) {
    const preferSilver = /\bsilver\b|ss360query=silver/i.test(seedUrl);
    const fetchUrl = rewriteShopPdpToInvestBullion(seedUrl, { preferSilver });
    const slug = slugFromUrl(fetchUrl);
    const jsonPath = path.join(DATA_DIR, `royal-mint-${slug}.json`);
    if (!fs.existsSync(jsonPath)) {
      rows.push({
        slug,
        seedUrl,
        sourceUrl: fetchUrl,
        status: "missing_json",
        imageUrlsCount: 0,
        productCount: 0,
        hasObv: false,
        hasRev: false,
        obvEqRev: false,
        hasAnyPackshot: false,
      });
      continue;
    }

    let j;
    try {
      j = JSON.parse(fs.readFileSync(jsonPath, "utf8"));
    } catch {
      rows.push({
        slug,
        seedUrl,
        sourceUrl: fetchUrl,
        status: "broken_json",
        imageUrlsCount: 0,
        productCount: 0,
        hasObv: false,
        hasRev: false,
        obvEqRev: false,
        hasAnyPackshot: false,
      });
      continue;
    }

    const c = j.coin || {};
    const raw = j.raw || {};
    const sourceUrl = String(c.source_url || fetchUrl);
    const imageUrls = Array.isArray(raw.imageUrls) ? raw.imageUrls : [];
    const product = Array.isArray(raw.imageUrlsProduct) ? raw.imageUrlsProduct : [];

    const obv = c.image_obverse || null;
    const rev = c.image_reverse || null;
    const bObv = c.image_blister_obverse || null;
    const bRev = c.image_blister_reverse || null;
    const box = c.image_box || null;
    const cert = c.image_certificate || null;

    const hasObv = !isEmpty(obv);
    const hasRev = !isEmpty(rev);
    const obvEqRev = hasObv && hasRev && String(obv) === String(rev);
    const hasAnyPackshot = !isEmpty(bObv) || !isEmpty(bRev) || !isEmpty(box) || !isEmpty(cert);
    const welcomeWall = /welcome to the royal mint/i.test(String(raw.title || c.title || ""));

    let status = "ok";
    if (!hasObv && !hasRev) status = hasAnyPackshot ? "only_packshot_no_sides" : "missing_both_sides";
    else if (!hasObv || !hasRev) status = "missing_one_side";
    else if (obvEqRev) status = "same_image_both_sides";

    rows.push({
      slug,
      seedUrl,
      sourceUrl,
      status,
      imageUrlsCount: imageUrls.length,
      productCount: product.length,
      hasObv,
      hasRev,
      obvEqRev,
      hasAnyPackshot,
      welcomeWall,
      obv: obv || "",
      rev: rev || "",
      box: box || "",
      cert: cert || "",
      bObv: bObv || "",
      bRev: bRev || "",
    });

    if (!sourceToSlugs.has(sourceUrl)) sourceToSlugs.set(sourceUrl, []);
    sourceToSlugs.get(sourceUrl).push(slug);

    for (const u of [obv, rev, bObv, bRev, box, cert]) {
      if (isEmpty(u)) continue;
      const s = String(u);
      if (!imageToSlugs.has(s)) imageToSlugs.set(s, []);
      imageToSlugs.get(s).push(slug);
    }
  }

  const duplicateSourceUrls = [...sourceToSlugs.entries()].filter(([, arr]) => arr.length > 1);
  const duplicateImageUrls = [...imageToSlugs.entries()].filter(([, arr]) => arr.length > 1);

  const summary = {
    totalSeed: seeds.length,
    rows: rows.length,
    byStatus: rows.reduce((acc, r) => {
      acc[r.status] = (acc[r.status] || 0) + 1;
      return acc;
    }, {}),
    duplicateSourceUrlCount: duplicateSourceUrls.length,
    duplicateImageUrlCount: duplicateImageUrls.length,
  };

  const outJson = {
    createdAt: new Date().toISOString(),
    summary,
    duplicateSourceUrls: duplicateSourceUrls.map(([url, slugs]) => ({ url, slugs })),
    duplicateImageUrls: duplicateImageUrls.map(([url, slugs]) => ({ url, slugs })),
    rows,
  };

  const jsonPath = path.join(DATA_DIR, "royal-mint-image-audit-report.json");
  fs.writeFileSync(jsonPath, JSON.stringify(outJson, null, 2), "utf8");

  const tsvHeader = [
    "slug",
    "status",
    "source_url",
    "image_urls_count",
    "product_count",
    "welcome_wall",
    "image_obverse",
    "image_reverse",
    "image_box",
    "image_certificate",
    "image_blister_obverse",
    "image_blister_reverse",
  ];
  const tsvLines = [tsvHeader.join("\t")];
  for (const r of rows) {
    const line = [
      r.slug,
      r.status,
      r.sourceUrl,
      r.imageUrlsCount,
      r.productCount,
      r.welcomeWall ? "1" : "0",
      r.obv,
      r.rev,
      r.box,
      r.cert,
      r.bObv,
      r.bRev,
    ].map((x) => String(x).replace(/\t/g, " ").replace(/\r?\n/g, " "));
    tsvLines.push(line.join("\t"));
  }
  const tsvPath = path.join(DATA_DIR, "royal-mint-image-audit-report.tsv");
  fs.writeFileSync(tsvPath, tsvLines.join("\n") + "\n", "utf8");

  console.log("Audit JSON:", jsonPath);
  console.log("Audit TSV :", tsvPath);
  console.log("Summary   :", JSON.stringify(summary, null, 2));
}

main();

