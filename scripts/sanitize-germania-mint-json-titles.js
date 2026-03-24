/**
 * Пакетно чистит title и subtitle в data/germania-mint-*.json (как при импорте).
 * Запуск: node scripts/sanitize-germania-mint-json-titles.js
 */
const fs = require("fs");
const path = require("path");
const { sanitizeGermaniaMintTitle } = require("./germania-mint-title-sanitize.js");

const DATA_DIR = path.join(__dirname, "..", "data");

function main() {
  const files = fs
    .readdirSync(DATA_DIR)
    .filter((f) => f.startsWith("germania-mint-") && f.endsWith(".json") && !f.includes("listing-products"));
  let changed = 0;
  for (const f of files) {
    const p = path.join(DATA_DIR, f);
    let raw;
    try {
      raw = JSON.parse(fs.readFileSync(p, "utf8"));
    } catch {
      continue;
    }
    let fileChanged = false;
    for (const key of ["title", "subtitle"]) {
      if (raw[key] == null) continue;
      const before = String(raw[key]);
      const after = sanitizeGermaniaMintTitle(before);
      if (after !== before) {
        raw[key] = after;
        fileChanged = true;
      }
    }
    if (fileChanged) {
      fs.writeFileSync(p, JSON.stringify(raw, null, 2) + "\n", "utf8");
      changed++;
      console.log("✓", f);
    }
  }
  console.log("Готово. Обновлено файлов:", changed, "/", files.length);
}

main();
