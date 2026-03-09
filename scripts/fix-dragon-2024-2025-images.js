/**
 * Фикс картинок для Dragon 2024/2025:
 * - Gold 1oz Proof 2024/2025 (id 4448, 4449)
 * - Dragon 2025 1oz Silver Proof Rectangular Coin (id 4451)
 *
 * Убираем чужие box/реверсы от Chinese Myths and Legends Platinum Dragon
 * и ставим свои dragon-*-*.webp там, где они есть.
 *
 * Запуск: node scripts/fix-dragon-2024-2025-images.js
 * Затем: node scripts/update-perth-from-canonical-json.js
 *        npm run data:export:incremental
 *        npm run build
 */

const fs = require("fs");
const path = require("path");

const DATA_DIR = path.join(__dirname, "..", "data");

function updateJson(file, updater) {
  const full = path.join(DATA_DIR, file);
  if (!fs.existsSync(full)) {
    console.warn("Нет файла:", file);
    return false;
  }
  const json = JSON.parse(fs.readFileSync(full, "utf8"));
  const before = JSON.stringify(json.coin, null, 2);
  updater(json);
  const after = JSON.stringify(json.coin, null, 2);
  if (before === after) {
    console.log("Без изменений:", file);
    return false;
  }
  fs.writeFileSync(full, JSON.stringify(json, null, 2), "utf8");
  console.log("✓ Обновлён:", file);
  return true;
}

function main() {
  let updated = 0;

  // Dragon 2025 1oz Gold Proof Coin
  updated += updateJson("perth-mint-dragon-2025-1oz-gold-proof-coin.json", (j) => {
    const c = j.coin || {};
    c.image_obverse = "/image/coins/foreign/dragon-2025-1oz-gold-proof-coin-obv.webp";
    c.image_reverse = "/image/coins/foreign/dragon-2025-1oz-gold-proof-coin-rev.webp";
    // Box для этой монеты у нас нет как отдельного webp — лучше null, чем чужой платиновый бокс
    c.image_box = null;
    j.coin = c;
    if (j.saved) {
      j.saved.obverse = c.image_obverse;
      j.saved.reverse = c.image_reverse;
      j.saved.box = c.image_box;
    }
  })
    ? 1
    : 0;

  // Dragon 2024 1oz Gold Proof Coin
  updated += updateJson("perth-mint-dragon-2024-1oz-gold-proof-coin.json", (j) => {
    const c = j.coin || {};
    c.image_obverse = "/image/coins/foreign/dragon-2024-1oz-gold-proof-coin-obv.webp";
    c.image_reverse = "/image/coins/foreign/dragon-2024-1oz-gold-proof-coin-rev.webp";
    c.image_box = null;
    j.coin = c;
    if (j.saved) {
      j.saved.obverse = c.image_obverse;
      j.saved.reverse = c.image_reverse;
      j.saved.box = c.image_box;
    }
  })
    ? 1
    : 0;

  // Dragon 2025 1oz Silver Proof Rectangular Coin
  updated += updateJson("perth-mint-dragon-2025-1oz-silver-proof-rectangular-coin.json", (j) => {
    const c = j.coin || {};
    c.image_obverse = "/image/coins/foreign/dragon-2025-1oz-silver-proof-rectangular-coin-obv.webp";
    c.image_reverse = "/image/coins/foreign/dragon-2025-1oz-silver-proof-rectangular-coin-rev.webp";
    c.image_box = "/image/coins/foreign/dragon-2025-1oz-silver-proof-rectangular-coin-box.webp";
    j.coin = c;
    if (j.saved) {
      j.saved.obverse = c.image_obverse;
      j.saved.reverse = c.image_reverse;
      j.saved.box = c.image_box;
    }
  })
    ? 1
    : 0;

  console.log(`Готово. Обновлено файлов: ${updated}. Дальше: update-perth-from-canonical-json.js → export → build.`);
}

main();

