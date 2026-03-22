/**
 * Пересчёт mintage / mintage_display в data/perth-mint-*.json по raw.specs без браузера
 * (логика как в fetch: Maximum Mintage → Issue Limit → Mintage; Unlimited → «Неограничен»).
 *
 *   node scripts/reapply-perth-mintage-from-json.js
 *   node scripts/reapply-perth-mintage-from-json.js data/perth-mint-one-file.json
 *
 * Дальше: node scripts/import-perth-mint-to-db.js [файл] и data:export.
 */
const fs = require("fs");
const path = require("path");
const { resolvePerthMintage } = require("./perth-mintage-resolve.js");

const DATA_DIR = path.join(__dirname, "..", "data");

function mintageNumEq(a, b) {
  if (a == null && b == null) return true;
  if (a == null || b == null) return false;
  return Number(a) === Number(b);
}

function mintageDispEq(a, b) {
  return String(a ?? "").trim() === String(b ?? "").trim();
}

function main() {
  const arg = process.argv[2];
  let files;
  if (arg && arg.endsWith(".json")) {
    const p = path.isAbsolute(arg) ? arg : path.join(process.cwd(), arg);
    files = [p];
  } else {
    files = fs
      .readdirSync(DATA_DIR)
      .filter((f) => f.startsWith("perth-mint-") && f.endsWith(".json"))
      .map((f) => path.join(DATA_DIR, f));
  }

  let updated = 0;
  let skipped = 0;
  for (const filePath of files) {
    let data;
    try {
      data = JSON.parse(fs.readFileSync(filePath, "utf8"));
    } catch {
      continue;
    }
    const specs = data.raw && data.raw.specs;
    if (!specs || typeof specs !== "object") {
      skipped++;
      continue;
    }
    const { mintage, mintage_display } = resolvePerthMintage(specs);
    const c = data.coin;
    if (!c) {
      skipped++;
      continue;
    }
    const prevM = c.mintage;
    const prevD = c.mintage_display;
    if (mintageNumEq(prevM, mintage) && mintageDispEq(prevD, mintage_display)) {
      skipped++;
      continue;
    }
    c.mintage = mintage;
    c.mintage_display = mintage_display;
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf8");
    updated++;
    console.log("✓", path.basename(filePath), "→ mintage:", mintage, "display:", mintage_display);
  }
  console.log("\nГотово. Обновлено:", updated, "| без изменений / нет specs:", skipped);
}

main();
