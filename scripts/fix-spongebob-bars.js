/**
 * Фикс картинок и series для слитков SpongeBob.
 *
 * - Проставляет series = "SpongeBob SquarePants" (в coin и raw.series, если нужно)
 * - Для 1g Gold Minted Bar (не coloured) ставит корректные obv/rev/cert webp.
 *
 * Запуск: node scripts/fix-spongebob-bars.js
 * Затем: node scripts/update-perth-from-canonical-json.js
 *        npm run data:export:incremental
 *        npm run build
 */
const fs = require("fs");
const path = require("path");

const DATA_DIR = path.join(__dirname, "..", "data");

function loadJson(file) {
  const full = path.join(DATA_DIR, file);
  if (!fs.existsSync(full)) {
    console.warn("Нет файла:", file);
    return null;
  }
  return { full, data: JSON.parse(fs.readFileSync(full, "utf8")) };
}

function main() {
  let updated = 0;

  // 1) Coloured bar: только прописываем серию.
  const coloured = loadJson("perth-mint-spongebob-squarepants-2025-1g-gold-coloured-minted-bar.json");
  if (coloured) {
    const j = coloured.data;
    const coin = j.coin || {};
    const raw = j.raw || {};
    const prevSeries = coin.series || null;
    if (!coin.series || coin.series === null) {
      coin.series = "SpongeBob SquarePants";
    }
    if (!raw.series || raw.series === null) {
      raw.series = "SpongeBob SquarePants";
    }
    j.coin = coin;
    j.raw = raw;
    fs.writeFileSync(coloured.full, JSON.stringify(j, null, 2), "utf8");
    updated++;
    console.log(
      `✓ coloured bar: series "${prevSeries || "null"}" → "${coin.series}"`
    );
  }

  // 2) Обычный 1g bar: серия + правильные картинки.
  const plain = loadJson("perth-mint-spongebob-squarepants-1g-gold-minted-bar.json");
  if (plain) {
    const j = plain.data;
    const coin = j.coin || {};
    const raw = j.raw || {};
    const prevSeries = coin.series || null;

    const base = "spongebob-squarepants-1g-gold-minted-bar";
    const obv = `/image/coins/foreign/${base}-obv.webp`;
    const rev = `/image/coins/foreign/${base}-rev.webp`;
    const cert = `/image/coins/foreign/${base}-cert.webp`;

    coin.image_obverse = obv;
    coin.image_reverse = rev;
    coin.image_certificate = cert;
    if (!coin.series || coin.series === null) {
      coin.series = "SpongeBob SquarePants";
    }

    raw.series = raw.series || "SpongeBob SquarePants";

    j.coin = coin;
    j.raw = raw;
    if (j.saved) {
      j.saved.obverse = obv;
      j.saved.reverse = rev;
      j.saved.certificate = cert;
    }

    fs.writeFileSync(plain.full, JSON.stringify(j, null, 2), "utf8");
    updated++;
    console.log(
      `✓ plain bar: series "${prevSeries || "null"}" → "${coin.series}", картинки переведены на ${base}-*.webp`
    );
  }

  console.log(`Готово. Обновлено объектов: ${updated}. Дальше: update-perth-from-canonical-json.js → export → build.`);
}

main();

