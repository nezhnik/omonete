/**
 * Фикс веса в унциях для Perth по официальным спекам.
 *
 * Для каждого perth-mint-*.json:
 *  - ищем в raw.specs поля:
 *      "Silver Content (Troy oz)" / "Gold Content (Troy oz)" / "Metal Content (Troy oz)"
 *  - если parsedOz отличается от coin.weight_oz больше чем на 0.01,
 *    переписываем coin.weight_oz на parsedOz.
 *
 * Это даёт высокую уверенность, т.к. опираемся на официальные поля,
 * а не на вычисления.
 *
 * Запуск:
 *   node scripts/fix-perth-weight-oz-from-specs.js
 * Затем:
 *   node scripts/update-perth-from-canonical-json.js
 *   npm run data:export:incremental
 *   npm run build
 */

const fs = require("fs");
const path = require("path");

const DATA_DIR = path.join(__dirname, "..", "data");

function parseOz(specs) {
  if (!specs || typeof specs !== "object") return null;
  const keys = ["Silver Content (Troy oz)", "Gold Content (Troy oz)", "Metal Content (Troy oz)"];
  for (const k of keys) {
    if (specs[k] != null) {
      const raw = String(specs[k]).replace(",", ".").trim();
      const num = parseFloat(raw);
      if (!Number.isNaN(num) && num > 0) return num;
    }
  }
  return null;
}

function main() {
  const files = fs
    .readdirSync(DATA_DIR)
    .filter((f) => f.startsWith("perth-mint-") && f.endsWith(".json"));

  const changed = [];
  const unresolved = [];

  for (const f of files) {
    const full = path.join(DATA_DIR, f);
    const j = JSON.parse(fs.readFileSync(full, "utf8"));
    const coin = j.coin || {};
    const specs = j.raw?.specs;
    const expectedOz = parseOz(specs);
    if (expectedOz == null) continue;

    const currentOz = coin.weight_oz != null ? Number(coin.weight_oz) : null;
    if (currentOz == null || Number.isNaN(currentOz)) {
      coin.weight_oz = expectedOz;
      j.coin = coin;
      fs.writeFileSync(full, JSON.stringify(j, null, 2), "utf8");
      changed.push({ file: f, from: null, to: expectedOz });
      continue;
    }

    if (Math.abs(currentOz - expectedOz) > 0.01) {
      coin.weight_oz = expectedOz;
      j.coin = coin;
      fs.writeFileSync(full, JSON.stringify(j, null, 2), "utf8");
      changed.push({ file: f, from: currentOz, to: expectedOz });
    }
  }

  const out = { changed };
  const outPath = path.join(DATA_DIR, "perth-weight-fixes.json");
  fs.writeFileSync(outPath, JSON.stringify(out, null, 2), "utf8");
  console.log(`Исправлено монет: ${changed.length}. Подробности: ${path.relative(process.cwd(), outPath)}`);
}

main();

