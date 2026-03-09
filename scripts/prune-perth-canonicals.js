/**
 * Оставляет только каноники для URL из perth-mint-urls.txt.
 * Удаляет «лишние» каноники от старых прогонов.
 *
 * Запуск:
 *   node scripts/prune-perth-canonicals.js --dry  — только отчёт, что удалится
 *   node scripts/prune-perth-canonicals.js         — удалить лишние
 */
const fs = require("fs");
const path = require("path");

const DATA_DIR = path.join(__dirname, "..", "data");
const URL_LIST_FILE = path.join(__dirname, "perth-mint-urls.txt");

function slugFromUrl(pageUrl) {
  const pathname = String(pageUrl).replace(/^https?:\/\/[^/]+/, "").replace(/\?.*$/, "").replace(/\/$/, "");
  const segments = pathname.split("/").filter(Boolean);
  const last = segments[segments.length - 1] || "perth-coin";
  return last
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "") || "perth-coin";
}

function main() {
  const dry = process.argv.includes("--dry");
  if (dry) console.log("Режим --dry: файлы не удаляются.\n");

  if (!fs.existsSync(URL_LIST_FILE)) {
    console.error("Нет файла", URL_LIST_FILE);
    process.exit(1);
  }

  const urlLines = fs.readFileSync(URL_LIST_FILE, "utf8")
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter((s) => s && s.startsWith("http"));

  const validSlugs = new Set(urlLines.map((u) => slugFromUrl(u)));
  console.log("URL в списке:", urlLines.length);
  console.log("Уникальных slug (ожидаемых каноников):", validSlugs.size);

  const EXCLUDE = ["perth-mint-fetch-progress.json", "perth-mint-listing-progress.json", "perth-mint-image-url-cache.json"];
  const files = fs.readdirSync(DATA_DIR)
    .filter((f) => f.startsWith("perth-mint-") && f.endsWith(".json") && !EXCLUDE.includes(f));

  const toKeep = [];
  const toDelete = [];

  for (const f of files) {
    const slug = f.replace(/^perth-mint-/, "").replace(/\.json$/, "");
    if (validSlugs.has(slug)) {
      toKeep.push(f);
    } else {
      toDelete.push(f);
    }
  }

  console.log("Каноников всего:", files.length);
  console.log("Соответствуют списку (оставляем):", toKeep.length);
  console.log("Лишние (удалить):", toDelete.length);

  if (toDelete.length > 0) {
    console.log("\nЛишние файлы:");
    toDelete.slice(0, 20).forEach((f) => console.log("  -", f));
    if (toDelete.length > 20) console.log("  ... и ещё", toDelete.length - 20);

    if (!dry) {
      for (const f of toDelete) {
        const p = path.join(DATA_DIR, f);
        fs.unlinkSync(p);
        console.log("  удалён:", f);
      }
      console.log("\nУдалено:", toDelete.length);
    }
  }

  const missing = [...validSlugs].filter((slug) => !toKeep.some((f) => f.replace(/^perth-mint-/, "").replace(/\.json$/, "") === slug));
  if (missing.length > 0) {
    console.log("\nURL в списке без каноника:", missing.length);
    missing.slice(0, 5).forEach((s) => console.log("  -", s));
    if (missing.length > 5) console.log("  ... и ещё", missing.length - 5);
    console.log("\nДля них нужно: node scripts/fetch-perth-mint-coin.js <url>");
  }
}

main();
