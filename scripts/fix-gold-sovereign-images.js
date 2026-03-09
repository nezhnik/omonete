/**
 * Правит картинки для новых Gold Sovereign (2025–2026),
 * у которых по ошибке стоят изображения от Australia Sovereign 2021.
 *
 * Запуск: node scripts/fix-gold-sovereign-images.js
 * Потом: node scripts/update-perth-from-canonical-json.js
 *        npm run data:export:incremental
 *        npm run build
 */
const fs = require("fs");
const path = require("path");

const DATA_DIR = path.join(__dirname, "..", "data");

// slug файла → правильный базовый префикс для картинок
const FIXES = {
  "perth-mint-australia-sovereign-2025-gold-proof-coin.json": "australia-sovereign-2025-gold-proof-coin",
  "perth-mint-the-half-sovereign-2025-gold-proof-coin.json": "the-half-sovereign-2025-gold-proof-coin",
  "perth-mint-the-half-sovereign-2026-gold-proof-coin.json": "the-half-sovereign-2026-gold-proof-coin",
  "perth-mint-the-sovereign-2026-gold-proof-coin.json": "the-sovereign-2026-gold-proof-coin",
  "perth-mint-the-sovereign-2026-silver-proof-coin.json": "the-sovereign-2026-silver-proof-coin",
};

function main() {
  let updated = 0;
  for (const [fileName, base] of Object.entries(FIXES)) {
    const fullPath = path.join(DATA_DIR, fileName);
    if (!fs.existsSync(fullPath)) {
      console.warn("Файл не найден, пропускаю:", fileName);
      continue;
    }
    const raw = JSON.parse(fs.readFileSync(fullPath, "utf8"));
    const coin = raw.coin || {};
    const prevObv = coin.image_obverse;
    const prevRev = coin.image_reverse;

    const obv = `/image/coins/foreign/${base}-obv.webp`;
    const rev = `/image/coins/foreign/${base}-rev.webp`;

    coin.image_obverse = obv;
    coin.image_reverse = rev;
    raw.coin = coin;

    if (raw.saved) {
      raw.saved.obverse = obv;
      raw.saved.reverse = rev;
    }

    fs.writeFileSync(fullPath, JSON.stringify(raw, null, 2), "utf8");
    updated++;
    console.log(
      `✓ ${fileName}: obv "${prevObv || "null"}" → "${obv}", rev "${prevRev || "null"}" → "${rev}"`
    );
  }

  console.log(`Готово. Обновлено файлов: ${updated}. Дальше: update-perth-from-canonical-json.js → export → build.`);
}

main();

