/**
 * Для URL из perth-mint-missing-in-db.txt: есть ли JSON?
 * Если есть — достаточно import. Если нет — нужен fetch --missing (без пропуска).
 */
const fs = require("fs");
const path = require("path");

const MISSING_FILE = path.join(__dirname, "perth-mint-missing-in-db.txt");
const PROGRESS_FILE = path.join(__dirname, "..", "data", "perth-mint-fetch-progress.json");
const DATA_DIR = path.join(__dirname, "..", "data");

function normUrl(u) {
  if (!u || typeof u !== "string") return null;
  return u.trim().replace(/\/+$/, "") || null;
}

function urlToSlug(url) {
  const m = url.match(/perthmint\.com\/shop\/collector-coins\/(?:coins\/|coin-sets\/|ingots[^/]*\/)?([^/?#]+)/);
  if (!m) return null;
  return m[1].toLowerCase().replace(/[^a-z0-9-]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "") || null;
}

function main() {
  if (!fs.existsSync(MISSING_FILE)) {
    console.log("Нет файла perth-mint-missing-in-db.txt. Сначала: node scripts/check-perth-urls-vs-db.js --write");
    process.exit(1);
  }

  const missingUrls = fs.readFileSync(MISSING_FILE, "utf8")
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter((s) => s && s.startsWith("http"));

  const progress = fs.existsSync(PROGRESS_FILE)
    ? JSON.parse(fs.readFileSync(PROGRESS_FILE, "utf8"))
    : {};
  const completedUrls = new Set((progress.completedUrls || []).map(normUrl).filter(Boolean));

  let hasJson = 0;
  let inProgress = 0;
  let noJson = [];

  for (const url of missingUrls) {
    const norm = normUrl(url);
    const slug = urlToSlug(url);
    const jsonPath = path.join(DATA_DIR, `perth-mint-${slug}.json`);
    const hasFile = fs.existsSync(jsonPath);
    const inProg = completedUrls.has(norm);

    if (hasFile) hasJson++;
    if (inProg) inProgress++;
    if (!hasFile) noJson.push({ url, inProg });
  }

  console.log("Недостающих в БД:", missingUrls.length);
  console.log("Есть JSON (можно import):", hasJson);
  console.log("В completedUrls (fetch пропустит):", inProgress);
  console.log("Нет JSON (нужен fetch):", noJson.length);
  if (noJson.length > 0) {
    console.log("\nПервые 5 без JSON:");
    noJson.slice(0, 5).forEach(({ url, inProg }) => console.log(" ", url.slice(-60), inProg ? "(в progress)" : ""));
  }
  console.log("\nРекомендация:");
  if (hasJson > 0) console.log("  node scripts/import-perth-mint-to-db.js --all-by-source-url  — добавит в БД");
  if (noJson.length > 0) console.log("  Для", noJson.length, "без JSON нужен fetch. Добавить --refresh чтобы не пропускать?");
}

main();
