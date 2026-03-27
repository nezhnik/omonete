/**
 * Достраивает classified.blister_reverse / blister_obverse из imageUrls для уже сохранённых JSON,
 * если второй кадр CertiPAMP есть в списке, но не попал в поле (типично *-certipamp.png без front/back).
 *
 *   node scripts/pamp-repair-blister-pairs-from-imageurls.js
 *
 * Дальше: npm run pamp:import && npm run data:export
 */
const fs = require("fs");
const path = require("path");

const DATA_DIR = path.join(__dirname, "..", "data");

function isCertiBlisterImageUrl(u) {
  const s = String(u || "").toLowerCase();
  return /certipamp|certi[-_]?(front|back)|back[-_]?certi|front[-_]?certi|obverse[-_]?certi|[-_/]certi\.|certi\.png/i.test(s);
}

function fillMissingBlisterSlotsFromImageUrls(classified, orderedUrls) {
  for (const u of orderedUrls) {
    if (!u || !isCertiBlisterImageUrl(u)) continue;
    if (u === classified.blister_obverse || u === classified.blister_reverse) continue;
    if (!classified.blister_reverse) classified.blister_reverse = u;
    else if (!classified.blister_obverse) classified.blister_obverse = u;
    else break;
  }
}

function main() {
  const files = fs
    .readdirSync(DATA_DIR)
    .filter((n) => n.startsWith("pamp-collectible-") && n.endsWith(".json") && !n.includes("listing"))
    .map((n) => path.join(DATA_DIR, n));

  let updated = 0;
  for (const filePath of files) {
    let data;
    try {
      data = JSON.parse(fs.readFileSync(filePath, "utf8"));
    } catch {
      continue;
    }
    const classified = data.classified && typeof data.classified === "object" ? { ...data.classified } : {};
    const urls = Array.isArray(data.imageUrls) ? data.imageUrls : [];
    const before = JSON.stringify({
      bo: classified.blister_obverse || null,
      br: classified.blister_reverse || null,
    });
    fillMissingBlisterSlotsFromImageUrls(classified, urls);
    const after = JSON.stringify({
      bo: classified.blister_obverse || null,
      br: classified.blister_reverse || null,
    });
    if (before === after) continue;
    data.classified = classified;
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf8");
    updated++;
    console.log(path.basename(filePath));
  }
  console.log("—");
  console.log("Обновлено файлов:", updated);
}

main();
