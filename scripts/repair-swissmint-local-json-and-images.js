/**
 * Починка уже сохранённых data/swissmint-*.json после смены вёрстки swissmintshop:
 * заголовок «Suggested Keywords», SVG в файлах .jpg, загаженные specs.
 *
 *   node scripts/repair-swissmint-local-json-and-images.js
 */
const fs = require("fs");
const path = require("path");
const {
  salvageTitle,
  extractSwissmintShopSpecsBlob,
  parseSpecPairs,
  fileKindFromBuffer,
} = require("./fetch-swissmint-product.js");

const ROOT = path.join(__dirname, "..");
const DATA_DIR = path.join(ROOT, "data");
const PUBLIC = path.join(ROOT, "public");

function publicPathFromUrl(rel) {
  if (!rel || typeof rel !== "string" || !rel.startsWith("/")) return null;
  return path.join(PUBLIC, rel.replace(/^\//, ""));
}

function fixImagePathsOnDisk(relPaths) {
  const renames = new Map();
  for (const rel of relPaths) {
    const abs = publicPathFromUrl(rel);
    if (!abs || !fs.existsSync(abs)) continue;
    let buf;
    try {
      buf = fs.readFileSync(abs);
    } catch {
      continue;
    }
    const kind = fileKindFromBuffer(buf);
    const ext = path.extname(abs).slice(1).toLowerCase();
    const need =
      kind === "svg" && ext !== "svg" ? "svg" : kind === "png" && ext !== "png" ? "png" : kind === "webp" && ext !== "webp" ? "webp" : null;
    if (!need) continue;
    const dir = path.dirname(abs);
    const base = path.basename(abs, path.extname(abs));
    const nextAbs = path.join(dir, `${base}.${need}`);
    try {
      fs.unlinkSync(abs);
    } catch {
      /* empty */
    }
    fs.writeFileSync(nextAbs, buf);
    renames.set(rel, `/image/coins/foreign/swissmint/${path.relative(path.join(PUBLIC, "image/coins/foreign/swissmint"), nextAbs).split(path.sep).join("/")}`);
  }
  return renames;
}

function preferRasterFirstInCoin(coin) {
  const urls = Array.isArray(coin.imageUrls) ? [...coin.imageUrls] : [];
  if (urls.length < 2 || !/\.svg$/i.test(urls[0])) return;
  const idx = urls.findIndex((p, i) => i > 0 && /\.(webp|jpe?g|png)$/i.test(p));
  if (idx <= 0) return;
  const [raster] = urls.splice(idx, 1);
  urls.unshift(raster);
  coin.imageUrls = urls;
  coin.image_obverse = urls[0] || coin.image_obverse;
  coin.image_reverse = urls[1] || urls[0] || coin.image_reverse;
}

function replaceUrlsInCoin(coin, renames) {
  const walk = (v) => {
    if (typeof v === "string") {
      return renames.get(v) || v;
    }
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === "object") {
      const o = {};
      for (const k of Object.keys(v)) o[k] = walk(v[k]);
      return o;
    }
    return v;
  };
  return walk(coin);
}

function main() {
  const files = fs
    .readdirSync(DATA_DIR)
    .filter((f) => f.startsWith("swissmint-") && f.endsWith(".json") && !f.includes("listing-products"))
    .map((f) => path.join(DATA_DIR, f));

  let fixed = 0;
  for (const fp of files) {
    const raw = JSON.parse(fs.readFileSync(fp, "utf8"));
    const c = raw.coin || {};
    if (!c.source_url) continue;
    const isShop = /swissmintshop\.admin\.ch/i.test(c.source_url);
    const titleStr = String(c.title || "");
    const titleBroken =
      /Suggested Keywords/i.test(titleStr) ||
      titleStr.length > 180 ||
      /\bWith over \d+,?\d*\s+lakes\b/i.test(titleStr);
    if (!isShop && !titleBroken) {
      preferRasterFirstInCoin(c);
      if (c === raw.coin) fs.writeFileSync(fp, JSON.stringify(raw, null, 2), "utf8");
      continue;
    }

    const blob = extractSwissmintShopSpecsBlob(c.specsText);
    const newSpecs = parseSpecPairs(blob);
    const newTitle = salvageTitle(c.title, c.specsText, c.source_url);

    const imageList = [c.image_obverse, c.image_reverse, ...(Array.isArray(c.imageUrls) ? c.imageUrls : [])].filter(Boolean);
    const renames = fixImagePathsOnDisk(imageList);
    if (renames.size) Object.assign(raw, { coin: replaceUrlsInCoin(c, renames) });

    const c2 = raw.coin;
    if (newTitle && newTitle !== c2.title) {
      c2.title = newTitle;
      fixed++;
    }
    if (Object.keys(newSpecs).length) {
      c2.specs = { ...c2.specs, ...newSpecs };
      for (const k of Object.keys(c2.specs || {})) {
        if (String(k).length > 80 || /Skip to Header/i.test(k)) delete c2.specs[k];
      }
    }

    preferRasterFirstInCoin(c2);

    fs.writeFileSync(fp, JSON.stringify(raw, null, 2), "utf8");
    console.log("OK", path.basename(fp), "→", c2.title);
  }
  console.log("Готово, переписано файлов с заголовком:", fixed);
}

main();
