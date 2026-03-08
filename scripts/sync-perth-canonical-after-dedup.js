/**
 * После удаления дублей JSON (find-perth-json-duplicates.js --delete) оставляем в прогрессе
 * и в списке URL только канонические: по одному source_url на каждый оставшийся JSON.
 * Так при следующем fetch --refresh мы перезапросим только эти страницы и не воссоздадим дубли.
 *
 * Запуск: node scripts/sync-perth-canonical-after-dedup.js
 */
const fs = require("fs");
const path = require("path");

const DATA_DIR = path.join(__dirname, "..", "data");
const PROGRESS_FILE = path.join(DATA_DIR, "perth-mint-fetch-progress.json");
const URL_LIST_FILE = path.join(__dirname, "perth-mint-urls.txt");

function main() {
  const files = fs.readdirSync(DATA_DIR)
    .filter((f) => f.startsWith("perth-mint-") && f.endsWith(".json") && f !== "perth-mint-fetch-progress.json" && f !== "perth-mint-image-url-cache.json");

  const canonicalUrls = [];
  const coinsFromJson = [];
  for (const f of files) {
    try {
      const data = JSON.parse(fs.readFileSync(path.join(DATA_DIR, f), "utf8"));
      const c = data.coin;
      const url = (c && c.source_url && String(c.source_url).trim()) || null;
      if (url) {
        canonicalUrls.push(url);
        coinsFromJson.push({
          url,
          jsonPath: path.join(DATA_DIR, f),
          catalog_number: (c.catalog_number && String(c.catalog_number).trim()) || null,
          title: (c.title && String(c.title).trim()) || null,
        });
      }
    } catch (e) {
      // skip
    }
  }

  const unique = [...new Set(canonicalUrls)];
  console.log("Канонических URL (из оставшихся JSON с source_url):", unique.length);

  const progress = { completedUrls: unique, coins: coinsFromJson };
  fs.writeFileSync(PROGRESS_FILE, JSON.stringify(progress, null, 2), "utf8");
  console.log("Обновлён прогресс: completedUrls =", progress.completedUrls.length, ", coins =", progress.coins.length);

  fs.writeFileSync(URL_LIST_FILE, unique.join("\n") + "\n", "utf8");
  console.log("Список URL записан:", URL_LIST_FILE, "—", unique.length, "URL");
}

main();
