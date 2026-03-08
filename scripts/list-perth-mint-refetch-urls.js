/**
 * Строит список URL «потерянных» монет: те, что при старом подходе (slug 40 символов + год)
 * перезаписали один и тот же JSON. Эти URL нужно переспарсить с новой логикой (1 URL = 1 файл).
 *
 * Запуск: node scripts/list-perth-mint-refetch-urls.js
 * Результат: scripts/perth-mint-refetch-urls.txt
 * Дальше: node scripts/fetch-perth-mint-coin.js --refetch-lost --refresh
 */
const fs = require("fs");
const path = require("path");

const DATA_DIR = path.join(__dirname, "..", "data");
const PROGRESS_FILE = path.join(DATA_DIR, "perth-mint-fetch-progress.json");
const OUT_FILE = path.join(__dirname, "perth-mint-refetch-urls.txt");

function normalizeUrl(u) {
  return String(u).trim().replace(/\/$/, "") || u;
}

const raw = JSON.parse(fs.readFileSync(PROGRESS_FILE, "utf8"));
const coins = raw.coins || [];

const byJsonPath = {};
for (const c of coins) {
  const p = c.jsonPath;
  if (!p) continue;
  if (!byJsonPath[p]) byJsonPath[p] = [];
  byJsonPath[p].push(c);
}

const lostUrls = [];
for (const [, group] of Object.entries(byJsonPath)) {
  if (group.length <= 1) continue;
  const urls = [...new Set(group.map((c) => c.url).filter(Boolean))];
  if (urls.length <= 1) continue;
  const sorted = urls.sort();
  for (let i = 0; i < sorted.length - 1; i++) {
    lostUrls.push(normalizeUrl(sorted[i]));
  }
}

const unique = [...new Set(lostUrls)];
fs.writeFileSync(OUT_FILE, unique.join("\n") + "\n", "utf8");
console.log("Потерянных URL (перезаписанных при старом slug):", unique.length);
console.log("Сохранено в", OUT_FILE);
console.log("Дальше: node scripts/fetch-perth-mint-coin.js --refetch-lost --refresh");
