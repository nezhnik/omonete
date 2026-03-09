/**
 * Тест: можно ли строить URL Perth Mint по названию монеты?
 * Сравнивает slug из source_url с тем, что получится из title по разным правилам.
 *
 *   node scripts/test-perth-title-to-url.js       — выборочно (первые 100)
 *   node scripts/test-perth-title-to-url.js --all  — все каноники
 */
const fs = require("fs");
const path = require("path");

const DATA_DIR = path.join(__dirname, "..", "data");
const BASE = "https://www.perthmint.com/shop/collector-coins/";

/** Простое правило: lowercase, пробелы и / → -, убрать ' и . */
function titleToSlugSimple(title) {
  if (!title || typeof title !== "string") return "";
  return title
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/\//g, "-")
    .replace(/['']/g, "")
    .replace(/\./g, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

/** С учётом типичных сокращений Perth (pr, hr, oz и т.д.). */
function titleToSlugHeuristic(title) {
  let s = titleToSlugSimple(title);
  // Perth часто: proof→pr, high relief→hr, ounce→oz
  s = s.replace(/\bproof\b/g, "pr");
  s = s.replace(/\bhigh-relief\b/g, "hr");
  s = s.replace(/\bounce\b/g, "oz");
  s = s.replace(/\breverse-proof\b/g, "reverse-pr");
  return s;
}

function extractSlugFromUrl(url) {
  if (!url) return "";
  const m = url.match(/perthmint\.com\/shop\/collector-coins\/(?:coins\/|coin-sets\/)?([^/?#]+)/);
  return m ? m[1] : "";
}

function main() {
  const all = process.argv.includes("--all");
  const files = fs
    .readdirSync(DATA_DIR)
    .filter((f) => f.startsWith("perth-mint-") && f.endsWith(".json") && !f.includes("progress") && !f.includes("cache"))
    .slice(0, all ? 9999 : 150);

  let exactSimple = 0;
  let exactHeur = 0;
  let similar = 0;
  const diffs = [];

  for (const f of files) {
    const data = JSON.parse(fs.readFileSync(path.join(DATA_DIR, f), "utf8"));
    const title = data?.coin?.title || data?.raw?.title || "";
    const source = data?.coin?.source_url || data?.source_url || "";
    const actualSlug = extractSlugFromUrl(source);
    if (!title || !actualSlug) continue;

    const simpleSlug = titleToSlugSimple(title);
    const heurSlug = titleToSlugHeuristic(title);

    if (simpleSlug === actualSlug) exactSimple++;
    else if (heurSlug === actualSlug) exactHeur++;
    else if (simpleSlug.includes(actualSlug) || actualSlug.includes(simpleSlug)) similar++;
    else diffs.push({ title: title.slice(0, 50), actual: actualSlug.slice(0, 60), simple: simpleSlug.slice(0, 60) });
  }

  const n = files.length;
  console.log("Проверено каноников:", n);
  console.log("Точное совпадение (simple):", exactSimple, `(${((exactSimple / n) * 100).toFixed(1)}%)`);
  console.log("Точное совпадение (heuristic):", exactHeur);
  console.log("Частично похоже:", similar);
  console.log("\nПримеры расхождений (первые 8):");
  diffs.slice(0, 8).forEach(({ title, actual, simple }) => {
    console.log("  title:", title);
    console.log("  actual:", actual);
    console.log("  simple:", simple);
    console.log("  ---");
  });
  if (diffs.length > 8) console.log("  ... и ещё", diffs.length - 8);
}

main();
