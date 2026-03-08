/**
 * Удаление дубликатов изображений Perth Mint по содержимому (хеш).
 * Один и тот же файл мог сохраняться под разными именами — оставляем один файл на группу,
 * в JSON подставляем путь к нему, остальные файлы удаляем.
 *
 * Запуск после завершения fetch: node scripts/dedupe-perth-mint-images.js
 * Режим --dry-run: только отчёт, без изменений.
 */
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const FOREIGN_DIR = path.join(__dirname, "..", "public", "image", "coins", "foreign");
const DATA_DIR = path.join(__dirname, "..", "data");

function sha256File(filePath) {
  const buf = fs.readFileSync(filePath);
  return crypto.createHash("sha256").update(buf).digest("hex");
}

function run() {
  const dryRun = process.argv.includes("--dry-run");
  if (dryRun) console.log("Режим --dry-run: изменения не применяются.\n");

  if (!fs.existsSync(FOREIGN_DIR)) {
    console.error("Папка не найдена:", FOREIGN_DIR);
    process.exit(1);
  }

  const files = fs.readdirSync(FOREIGN_DIR).filter((f) => f.endsWith(".webp"));
  console.log("Файлов .webp:", files.length);

  const byHash = {};
  for (const f of files) {
    const fullPath = path.join(FOREIGN_DIR, f);
    const hash = sha256File(fullPath);
    if (!byHash[hash]) byHash[hash] = [];
    byHash[hash].push(f);
  }

  const duplicateGroups = Object.entries(byHash).filter(([, list]) => list.length > 1);
  console.log("Групп дубликатов (одинаковое содержимое):", duplicateGroups.length);

  const relPath = (name) => "/image/coins/foreign/" + name;
  const pathToReplace = {}; // duplicate relPath -> canonical relPath
  const toDelete = new Set(); // file names to delete

  for (const [, list] of duplicateGroups) {
    list.sort();
    const canonical = list[0];
    const canonicalRel = relPath(canonical);
    for (let i = 1; i < list.length; i++) {
      pathToReplace[relPath(list[i])] = canonicalRel;
      toDelete.add(list[i]);
    }
  }

  const replaceCount = Object.keys(pathToReplace).length;
  console.log("Путей к замене в JSON:", replaceCount);
  console.log("Файлов к удалению:", toDelete.size);
  if (replaceCount === 0) {
    console.log("Дубликатов нет. Выход.");
    return;
  }

  const jsonFiles = fs.readdirSync(DATA_DIR).filter((f) => f.startsWith("perth-mint-") && f.endsWith(".json"));
  let jsonUpdated = 0;
  let refsUpdated = 0;

  for (const name of jsonFiles) {
    const filePath = path.join(DATA_DIR, name);
    const raw = JSON.parse(fs.readFileSync(filePath, "utf8"));
    const c = raw.coin;
    if (!c) continue;

    let changed = false;
    const fields = ["image_obverse", "image_reverse", "image_box", "image_certificate"];
    for (const key of fields) {
      const val = c[key];
      if (val && pathToReplace[val]) {
        c[key] = pathToReplace[val];
        changed = true;
        refsUpdated++;
      }
    }
    if (changed) {
      jsonUpdated++;
      if (!dryRun) {
        fs.writeFileSync(filePath, JSON.stringify(raw, null, 2), "utf8");
      }
    }
  }

  console.log("JSON файлов обновлено:", jsonUpdated, "| ссылок заменено:", refsUpdated);

  if (!dryRun && toDelete.size > 0) {
    for (const name of toDelete) {
      const fullPath = path.join(FOREIGN_DIR, name);
      if (fs.existsSync(fullPath)) {
        fs.unlinkSync(fullPath);
        console.log("  удалён:", name);
      }
    }
    console.log("Удалено файлов:", toDelete.size);
  } else if (dryRun && toDelete.size > 0) {
    console.log("(при запуске без --dry-run было бы удалено", toDelete.size, "файлов)");
  }

  console.log("\nГотово.");
}

run();
