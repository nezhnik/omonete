/**
 * Патч data/monnaie-de-paris-*.json: заменить мелкие width/height в URL каталога на 700.
 * После патча: npm run mdp:import:force-packaging-images && npm run data:export:incremental
 */
const fs = require("fs");
const path = require("path");
const { upgradeMdpCatalogProductUrl } = require("./mdp-catalog-image-url.js");

const DATA_DIR = path.join(__dirname, "..", "data");

function patchRaw(raw) {
  let urlChanges = 0;
  const up = (u) => {
    if (typeof u !== "string") return u;
    const x = upgradeMdpCatalogProductUrl(u);
    if (x !== u) urlChanges++;
    return x;
  };

  if (Array.isArray(raw.imageUrls)) {
    raw.imageUrls = raw.imageUrls.map(up);
  }
  if (Array.isArray(raw.gallery)) {
    raw.gallery = raw.gallery.map((g) => {
      if (!g || typeof g !== "object") return g;
      return {
        ...g,
        img: g.img != null ? up(String(g.img)) : g.img,
        full: g.full != null ? up(String(g.full)) : g.full,
        thumb: g.thumb != null ? up(String(g.thumb)) : g.thumb,
      };
    });
  }
  if (raw.classified && typeof raw.classified === "object") {
    const c = raw.classified;
    if (c.obverse) c.obverse = up(String(c.obverse));
    if (c.reverse) c.reverse = up(String(c.reverse));
    if (Array.isArray(c.packaging)) {
      c.packaging = c.packaging.map((p) => {
        if (!p || typeof p !== "object") return p;
        return p.url != null ? { ...p, url: up(String(p.url)) } : p;
      });
    }
  }
  return urlChanges;
}

function main() {
  const files = fs
    .readdirSync(DATA_DIR)
    .filter(
      (f) =>
        f.startsWith("monnaie-de-paris-") &&
        f.endsWith(".json") &&
        !f.includes("listing-products") &&
        !f.includes("fetch-checkpoint")
    )
    .map((f) => path.join(DATA_DIR, f))
    .sort();

  let fileEdited = 0;
  let totalUrls = 0;
  let fourImg = 0;
  for (const fp of files) {
    let raw;
    try {
      raw = JSON.parse(fs.readFileSync(fp, "utf8"));
    } catch {
      continue;
    }
    if (Array.isArray(raw.imageUrls) && raw.imageUrls.length === 4) fourImg++;
    const n = patchRaw(raw);
    if (n > 0) {
      fs.writeFileSync(fp, JSON.stringify(raw, null, 2) + "\n", "utf8");
      fileEdited++;
      totalUrls += n;
    }
  }
  console.log("Файлов JSON (MDP PDP):", files.length);
  console.log("С ровно 4 imageUrls:", fourImg);
  console.log("Исправлено файлов:", fileEdited, "| замен URL:", totalUrls);
}

main();
