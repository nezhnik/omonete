/**
 * Синхронизирует imageUrl / imageUrls / imageUrlRoles в public/data/coins/<id>.json
 * с данными из public/data/coins.json (каталог).
 *
 * Нужно после исправления export-coins-to-json.js: старые детальные JSON могли
 * содержать imageUrls без главного кадра (как у 5130).
 *
 * Запуск: node scripts/sync-detail-images-from-catalog.js
 */
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const listPath = path.join(root, "public", "data", "coins.json");
const coinsDir = path.join(root, "public", "data", "coins");

function sameUrls(a, b) {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

function applyListImages(coin, catalog) {
  let changed = false;
  if (coin.imageUrl !== catalog.imageUrl) {
    coin.imageUrl = catalog.imageUrl;
    changed = true;
  }
  if (!sameUrls(coin.imageUrls, catalog.imageUrls)) {
    if (catalog.imageUrls == null || (Array.isArray(catalog.imageUrls) && catalog.imageUrls.length === 0)) {
      delete coin.imageUrls;
    } else {
      coin.imageUrls = catalog.imageUrls;
    }
    changed = true;
  }
  if (!sameUrls(coin.imageUrlRoles, catalog.imageUrlRoles)) {
    if (catalog.imageUrlRoles == null || (Array.isArray(catalog.imageUrlRoles) && catalog.imageUrlRoles.length === 0)) {
      delete coin.imageUrlRoles;
    } else {
      coin.imageUrlRoles = catalog.imageUrlRoles;
    }
    changed = true;
  }
  return changed;
}

function run() {
  const { coins } = JSON.parse(fs.readFileSync(listPath, "utf8"));
  let updated = 0;
  let missing = 0;
  for (const row of coins) {
    const id = String(row.id);
    const fp = path.join(coinsDir, `${id}.json`);
    if (!fs.existsSync(fp)) {
      missing++;
      continue;
    }
    let obj;
    try {
      obj = JSON.parse(fs.readFileSync(fp, "utf8"));
    } catch {
      console.warn("skip parse error", id);
      continue;
    }
    if (!obj.coin) continue;
    if (applyListImages(obj.coin, row)) {
      fs.writeFileSync(fp, JSON.stringify(obj));
      updated++;
    }
  }
  console.log("✓ Обновлено детальных JSON:", updated);
  if (missing) console.log("  (в каталоге есть id без файла:", missing + ")");
}

run();
