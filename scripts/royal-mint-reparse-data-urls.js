/**
 * Собирает source_url из data/royal-mint-*.json, где в файле встречается подстрока
 * (по умолчанию shadow-edge), и опционально перезапускает fetch-royal-mint-coin-test.js.
 *
 *   node scripts/royal-mint-reparse-data-urls.js
 *   node scripts/royal-mint-reparse-data-urls.js --pattern shadow-edge --run
 *   node scripts/royal-mint-reparse-data-urls.js --pattern "404 PAGE" --run   (осторожно)
 */
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const DATA_DIR = path.join(__dirname, "..", "data");
const OUT_FILE = path.join(__dirname, "royal-mint-reparse-queue.txt");
const FETCH_SCRIPT = path.join(__dirname, "fetch-royal-mint-coin-test.js");
const { isRoyalMintTrialOfPyxUrl } = require("./royal-mint-listing-collect.js");
const root = path.join(__dirname, "..");

const pi = process.argv.indexOf("--pattern");
const pattern = pi >= 0 && process.argv[pi + 1] ? process.argv[pi + 1] : "shadow-edge";
const run = process.argv.includes("--run");

const urls = new Set();
for (const f of fs.readdirSync(DATA_DIR)) {
  if (!f.startsWith("royal-mint-") || !f.endsWith(".json")) continue;
  if (f.includes("skipped") || f.includes("verify") || f.includes("progress") || f.includes("listing")) continue;
  const fp = path.join(DATA_DIR, f);
  let text;
  try {
    text = fs.readFileSync(fp, "utf8");
  } catch {
    continue;
  }
  if (!text.toLowerCase().includes(String(pattern).toLowerCase())) continue;
  let j;
  try {
    j = JSON.parse(text);
  } catch {
    continue;
  }
  const u = (j.coin && j.coin.source_url) || (j.raw && j.raw.pdpUrl) || (j.raw && j.raw.requestedUrl);
  if (u && /royalmint\.com/i.test(String(u))) {
    const clean = String(u)
      .trim()
      .replace(/\?.*$/, "")
      .replace(/\/+$/, "");
    if (!isRoyalMintTrialOfPyxUrl(clean)) urls.add(clean);
  }
}

const list = [...urls].sort();
fs.writeFileSync(OUT_FILE, list.join("\n") + "\n", "utf8");
console.log("Паттерн:", pattern);
console.log("Очередь:", OUT_FILE);
console.log("Уникальных URL:", list.length);
list.forEach((u) => console.log(" ", u));

if (run) {
  console.log("\nЗапуск fetch-royal-mint-coin-test.js …");
  for (const u of list) {
    console.log("\n———\n", u);
    const r = spawnSync(process.execPath, [FETCH_SCRIPT, u], { cwd: root, stdio: "inherit" });
    if (r.status !== 0) console.warn("Код выхода:", r.status);
  }
  console.log("\nГотово. Дальше: npm run royal-mint:import → npm run data:export");
}
