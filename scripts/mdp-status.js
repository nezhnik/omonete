/**
 * Снимок прогресса Monnaie de Paris (листинг / PDP / фетч в фоне).
 *   npm run mdp:status
 *
 * В фоне (nohup) вывод скрипта не в терминал — смотрите лог или эту команду.
 */
const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const DATA_DIR = path.join(__dirname, "..", "data");
const LISTING = path.join(DATA_DIR, "monnaie-de-paris-listing-products.json");
const CHECKPOINT = path.join(DATA_DIR, "monnaie-de-paris-fetch-checkpoint.json");
const PROGRESS = path.join(DATA_DIR, "monnaie-de-paris-fetch-progress.ndjson");

function countPdpJson() {
  if (!fs.existsSync(DATA_DIR)) return 0;
  return fs
    .readdirSync(DATA_DIR)
    .filter(
      (f) =>
        f.startsWith("monnaie-de-paris-") &&
        f.endsWith(".json") &&
        !f.includes("listing-products") &&
        !f.includes("fetch-checkpoint")
    ).length;
}

function pgrepLine() {
  try {
    return execSync('pgrep -fl "fetch-monnaie-de-paris-all.js" || true', { encoding: "utf8" }).trim();
  } catch {
    return "";
  }
}

let listingN = 0;
try {
  const j = JSON.parse(fs.readFileSync(LISTING, "utf8"));
  listingN = Array.isArray(j) ? j.length : 0;
} catch {
  listingN = 0;
}

const pdp = countPdpJson();
let checkpoint = null;
try {
  checkpoint = JSON.parse(fs.readFileSync(CHECKPOINT, "utf8"));
} catch {
  checkpoint = null;
}

let progressLines = 0;
let okTrue = 0;
let okFalse = 0;
if (fs.existsSync(PROGRESS)) {
  const text = fs.readFileSync(PROGRESS, "utf8").trim();
  if (text) {
    const lines = text.split("\n");
    progressLines = lines.length;
    for (const line of lines) {
      try {
        const o = JSON.parse(line);
        if (o.ok === true) okTrue++;
        else if (o.ok === false) okFalse++;
      } catch {
        /* ignore */
      }
    }
  }
}

console.log("— Monnaie de Paris —");
console.log("Листинг URL:     ", listingN || "—");
console.log("PDP JSON на диске:", pdp, `(ещё ${listingN ? Math.max(0, listingN - pdp) : "?"} до полного листинга)`);
console.log("fetch-progress:  ", progressLines, "попыток (ok:", okTrue + ", fail:", okFalse + ")");
if (checkpoint) {
  console.log("Чекпоинт фетча: ", checkpoint.last_index, "/", checkpoint.total, "| ok:", checkpoint.ok, "fail:", checkpoint.fail);
  console.log("  обновлён:", checkpoint.updated_at);
  console.log("  последний:", checkpoint.last_url);
} else {
  console.log("Чекпоинт фетча:  (ещё не создавался)");
}
const pg = pgrepLine();
console.log("Процесс:        ", pg || "(fetch-monnaie-de-paris-all не запущен)");
console.log("");
console.log("Лог (хвост): tail -40 data/mdp-auto-run.log");
console.log("Живой лог:    tail -f data/mdp-auto-run.log");
