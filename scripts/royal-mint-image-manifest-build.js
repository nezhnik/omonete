/**
 * Строит manifest картинок Royal Mint по локальным JSON:
 * - прямые URL из raw.classified + coin.image_*
 * - candidates из raw.imageUrlsProduct/raw.imageUrls
 * - confidence и флаги качества
 *
 * Выход:
 * - data/royal-mint-image-manifest.json
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

function nonEmpty(v) {
  return v != null && String(v).trim() !== "";
}

function unique(list) {
  const seen = new Set();
  const out = [];
  for (const x of list) {
    const v = String(x || "").trim();
    if (!v || seen.has(v)) continue;
    seen.add(v);
    out.push(v);
  }
  return out;
}

function main() {
  const seeds = readSeedUrlsFromFile(SEED_FILE);
  const entries = [];

  for (const seedUrl of seeds) {
    const preferSilver = /\bsilver\b|ss360query=silver/i.test(seedUrl);
    const fetchUrl = rewriteShopPdpToInvestBullion(seedUrl, { preferSilver });
    const slug = slugFromUrl(fetchUrl);
    const jsonPath = path.join(DATA_DIR, `royal-mint-${slug}.json`);
    if (!fs.existsSync(jsonPath)) {
      entries.push({
        slug,
        seed_url: seedUrl,
        source_url: fetchUrl,
        json_path: jsonPath,
        status: "missing_json",
      });
      continue;
    }

    let j;
    try {
      j = JSON.parse(fs.readFileSync(jsonPath, "utf8"));
    } catch (e) {
      entries.push({
        slug,
        seed_url: seedUrl,
        source_url: fetchUrl,
        json_path: jsonPath,
        status: "broken_json",
        error: e.message,
      });
      continue;
    }

    const c = j.coin || {};
    const raw = j.raw || {};
    const cls = raw.classified || {};

    const roles = {
      obverse: cls.obverse || "",
      reverse: cls.reverse || "",
      blister_obverse: cls.blister_obverse || "",
      blister_reverse: cls.blister_reverse || "",
      box: cls.box || "",
      certificate: cls.certificate || "",
    };

    const coinLocal = {
      image_obverse: c.image_obverse || "",
      image_reverse: c.image_reverse || "",
      image_blister_obverse: c.image_blister_obverse || "",
      image_blister_reverse: c.image_blister_reverse || "",
      image_box: c.image_box || "",
      image_certificate: c.image_certificate || "",
    };

    const candidates_product = unique(raw.imageUrlsProduct || []);
    const candidates_all = unique(raw.imageUrls || []);

    const hasObv = nonEmpty(roles.obverse) || nonEmpty(coinLocal.image_obverse);
    const hasRev = nonEmpty(roles.reverse) || nonEmpty(coinLocal.image_reverse);
    const sameSide = nonEmpty(roles.obverse) && nonEmpty(roles.reverse) && roles.obverse === roles.reverse;
    const welcomeWall = /welcome to the royal mint/i.test(String(raw.title || c.title || ""));

    let confidence = "low";
    if (hasObv && hasRev && !sameSide) confidence = "high";
    else if (hasObv && hasRev && sameSide) confidence = "medium";
    else if (hasObv || hasRev) confidence = "medium";

    entries.push({
      slug,
      seed_url: seedUrl,
      source_url: c.source_url || fetchUrl,
      title: c.title || raw.title || "",
      json_path: jsonPath,
      status: hasObv && hasRev ? "has_sides" : "missing_sides",
      confidence,
      flags: {
        welcome_wall: welcomeWall,
        same_obverse_reverse: sameSide,
        product_candidates_count: candidates_product.length,
        all_candidates_count: candidates_all.length,
      },
      roles,
      coin_local: coinLocal,
      candidates_product,
      candidates_all,
    });
  }

  const manifest = {
    version: 1,
    createdAt: new Date().toISOString(),
    seed_file: SEED_FILE,
    total: entries.length,
    missing_sides: entries.filter((e) => e.status === "missing_sides").length,
    entries,
  };

  const outPath = path.join(DATA_DIR, "royal-mint-image-manifest.json");
  fs.writeFileSync(outPath, JSON.stringify(manifest, null, 2), "utf8");
  console.log("Manifest:", outPath);
  console.log("Total   :", manifest.total, "missing_sides:", manifest.missing_sides);
}

main();

