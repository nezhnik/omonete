/**
 * Фикс картинок для Discover Australia (gold 2012),
 * где реверс ошибочно взят от 2013 Koala silver.
 *
 * Запуск: node scripts/fix-discover-australia-gold-images.js
 * Затем: node scripts/update-perth-from-canonical-json.js
 *        npm run data:export:incremental
 *        npm run build
 */
const fs = require("fs");
const path = require("path");

const DATA_DIR = path.join(__dirname, "..", "data");

const TARGETS = {
  "perth-mint-discover-australia-kookaburra-2012-1-2oz-gold-proof-coin.json":
    "discover-australia-kookaburra-2012-1-2oz-gold-proof-coin",
  "perth-mint-discover-australia-goanna-2012-1-2oz-gold-proof-coin.json":
    "discover-australia-goanna-2012-1-2oz-gold-proof-coin",
};

function main() {
  let updated = 0;
  for (const [fileName, base] of Object.entries(TARGETS)) {
    const fullPath = path.join(DATA_DIR, fileName);
    if (!fs.existsSync(fullPath)) {
      console.warn("Файл не найден, пропускаю:", fileName);
      continue;
    }
    const raw = JSON.parse(fs.readFileSync(fullPath, "utf8"));
    const coin = raw.coin || {};
    const prevRev = coin.image_reverse;

    const obv = `/image/coins/foreign/${base}-obv.webp`;
    const rev = `/image/coins/foreign/${base}-rev.webp`;

    // Реверса как отдельного файла у нас нет, поэтому:
    // 1) оставляем obverse корректным
    // 2) реверс в coin и saved ставим null — тогда в каталоге первой будет obverse.
    coin.image_obverse = obv;
    coin.image_reverse = null;
    raw.coin = coin;

    if (raw.saved) {
      raw.saved.obverse = obv;
      raw.saved.reverse = null;
    }

    fs.writeFileSync(fullPath, JSON.stringify(raw, null, 2), "utf8");
    updated++;
    console.log(`✓ ${fileName}: reverse "${prevRev || "null"}" → null, obverse "${obv}"`);
  }
  console.log(`Готово. Обновлено файлов: ${updated}. Дальше: update-perth-from-canonical-json.js → export → build.`);
}

main();

