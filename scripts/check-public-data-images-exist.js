/**
 * Проверка: все локальные пути /image/... в public/data существуют в public/.
 * Код выхода 0 — ок, 1 — есть «фантомы» (как после export без prune).
 *
 *   node scripts/check-public-data-images-exist.js
 *   node scripts/check-public-data-images-exist.js --list=20   # сколько примеров вывести
 */
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const PUBLIC = path.join(ROOT, "public");
const COINS_LIST = path.join(ROOT, "public", "data", "coins.json");
const COINS_DIR = path.join(ROOT, "public", "data", "coins");

const listMax = (() => {
  const a = process.argv.find((x) => x.startsWith("--list="));
  if (!a) return 15;
  const n = Number(a.slice("--list=".length));
  return Number.isFinite(n) && n >= 0 ? n : 15;
})();

function existsLocal(u) {
  if (u == null || typeof u !== "string") return false;
  const t = u.trim();
  if (!t.startsWith("/")) return true;
  return fs.existsSync(path.join(PUBLIC, t.replace(/^\//, "")));
}

function main() {
  if (!fs.existsSync(COINS_LIST)) {
    console.error("Нет", COINS_LIST);
    process.exit(1);
  }
  const phantom = [];
  const list = JSON.parse(fs.readFileSync(COINS_LIST, "utf8"));
  const coins = list.coins;
  if (!Array.isArray(coins)) {
    console.error("coins.json: нет coins[]");
    process.exit(1);
  }
  for (const c of coins) {
    const urls = [c.imageUrl, ...(c.imageUrls || [])].filter(Boolean);
    for (const u of urls) {
      if (String(u).startsWith("/image/") && !existsLocal(u)) {
        phantom.push({ scope: "coins.json", id: c.id, url: u });
      }
    }
  }

  if (fs.existsSync(COINS_DIR)) {
    for (const name of fs.readdirSync(COINS_DIR)) {
      if (!name.endsWith(".json")) continue;
      let j;
      try {
        j = JSON.parse(fs.readFileSync(path.join(COINS_DIR, name), "utf8"));
      } catch {
        continue;
      }
      const coin = j.coin;
      if (!coin) continue;
      const urls = [coin.imageUrl, ...(coin.imageUrls || []), ...(Array.isArray(j.sameSeries) ? j.sameSeries.map((s) => s.imageUrl) : [])].filter(Boolean);
      for (const u of urls) {
        if (String(u).startsWith("/image/") && !existsLocal(u)) {
          phantom.push({ scope: name.slice(0, -5), url: u });
        }
      }
    }
  }

  const unique = phantom.length;
  if (unique === 0) {
    console.log("OK: фантомных локальных /image/ в public/data нет.");
    process.exit(0);
  }
  console.error(`FAIL: ${phantom.length} ссылок на отсутствующие файлы. Запустите: npm run data:prune-missing-images`);
  for (const p of phantom.slice(0, listMax)) {
    console.error(" ", p.scope, p.id != null ? `id=${p.id}` : "", p.url);
  }
  if (phantom.length > listMax) console.error(`  … ещё ${phantom.length - listMax}`);
  process.exit(1);
}

main();
