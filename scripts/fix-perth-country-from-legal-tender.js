/**
 * Исправляет country в канонических Perth JSON по полю raw.specs["Legal Tender"].
 * Если на сайте указано Legal Tender: Australia, а в coin.country стоит Тувалу (или наоборот) —
 * выравниваем country под спеки, чтобы в каталоге отображалась правильная страна.
 *
 * Запуск:
 *   node scripts/fix-perth-country-from-legal-tender.js       — исправить файлы в data/
 *   node scripts/fix-perth-country-from-legal-tender.js --dry — только показать, что изменится
 */
require("dotenv").config({ path: ".env" });
const fs = require("fs");
const path = require("path");
const { normalizeLegalTender } = require("./format-coin-characteristics.js");

const DATA_DIR = path.join(__dirname, "..", "data");

function trim(s) {
  return s != null && typeof s === "string" ? s.trim() || null : null;
}

function main() {
  const dryRun = process.argv.includes("--dry");
  if (dryRun) console.log("Режим --dry: файлы не изменяются.\n");

  if (!fs.existsSync(DATA_DIR)) {
    console.error("Папка data не найдена");
    process.exit(1);
  }
  const files = fs.readdirSync(DATA_DIR)
    .filter((f) => f.startsWith("perth-mint-") && f.endsWith(".json"))
    .map((f) => path.join(DATA_DIR, f));

  let fixed = 0;
  for (const filePath of files) {
    let raw;
    try {
      raw = JSON.parse(fs.readFileSync(filePath, "utf8"));
    } catch {
      continue;
    }
    const c = raw?.coin;
    if (!c) continue;
    const legalTender = raw?.raw?.specs?.["Legal Tender"];
    const countryFromSpec = normalizeLegalTender(legalTender);
    if (countryFromSpec == null) continue; // N/A или неизвестный — не трогаем
    const current = trim(c.country);
    if (current === countryFromSpec) continue;
    const title = (c.title || "").slice(0, 55);
    console.log((dryRun ? "[dry] " : "") + path.basename(filePath));
    console.log("  country: \"" + (current || "(пусто)") + "\" → \"" + countryFromSpec + "\"  " + title);
    if (!dryRun) {
      c.country = countryFromSpec;
      fs.writeFileSync(filePath, JSON.stringify(raw, null, 2), "utf8");
    }
    fixed++;
  }
  console.log("\n" + (dryRun ? "Будет исправлено файлов: " : "Исправлено файлов: ") + fixed);
  if (fixed > 0 && !dryRun) {
    console.log("Дальше: node scripts/update-perth-from-canonical-json.js → export-coins-to-json.js → npm run build");
  }
}

main();
