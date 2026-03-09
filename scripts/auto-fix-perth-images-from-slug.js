/**
 * Аккуратный автофикс картинок Perth по slug из source_url.
 *
 * Идея:
 *  - slug = последний сегмент source_url (как в redownload-perth-images-from-raw)
 *  - ожидаемые пути:
 *      /image/coins/foreign/<slug>-obv.webp
 *      /image/coins/foreign/<slug>-rev.webp
 *      /image/coins/foreign/<slug>-box.webp
 *      /image/coins/foreign/<slug>-cert.webp
 *  - если такой файл существует, а текущий coin.image_*:
 *      - пустой ИЛИ
 *      - не содержит slug в пути (явно чужая монета),
 *    то переписываем на правильный путь.
 *
 * Это даёт нам высокий уровень уверенности:
 *  - мы НИКОГДА не трогаем картинки, где путь уже содержит slug монеты;
 *  - используем только уже скачанные webp с ожидаемым именем.
 *
 * Запуск:
 *   node scripts/auto-fix-perth-images-from-slug.js
 * Затем:
 *   node scripts/update-perth-from-canonical-json.js
 *   npm run data:export:incremental
 *   npm run build
 */

const fs = require("fs");
const path = require("path");

const DATA_DIR = path.join(__dirname, "..", "data");

function slugFromSourceUrl(url) {
  if (!url) return null;
  const pathname = String(url).replace(/^https?:\/\/[^/]+/, "").replace(/\?.*$/, "").replace(/\/$/, "");
  const segments = pathname.split("/").filter(Boolean);
  const last = segments[segments.length - 1] || "perth-coin";
  return (
    last
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "") || "perth-coin"
  );
}

function fixImagesForFile(fileName) {
  const fullPath = path.join(DATA_DIR, fileName);
  if (!fs.existsSync(fullPath)) return { updated: 0, skipped: true };

  const raw = JSON.parse(fs.readFileSync(fullPath, "utf8"));
  const coin = raw.coin || {};
  const sourceUrl = coin.source_url;
  if (!sourceUrl || !sourceUrl.includes("perthmint.com")) return { updated: 0, skipped: true };

  const slug = slugFromSourceUrl(sourceUrl);
  if (!slug) return { updated: 0, skipped: true };

  const roles = [
    { key: "image_obverse", suffix: "obv" },
    { key: "image_reverse", suffix: "rev" },
    { key: "image_box", suffix: "box" },
    { key: "image_certificate", suffix: "cert" },
  ];

  let updated = 0;
  for (const { key, suffix } of roles) {
    const expected = `/image/coins/foreign/${slug}-${suffix}.webp`;
    const isFile = fs.existsSync(path.join(__dirname, "..", "public", expected.replace(/^\/+/, "")));
    if (!isFile) continue;

    const current = coin[key] || null;
    const hasSlug = current && String(current).includes(slug);
    if (hasSlug) continue; // уже своя картинка

    if (!current || !hasSlug) {
      coin[key] = expected;
      if (raw.saved) {
        if (suffix === "obv") raw.saved.obverse = expected;
        else if (suffix === "rev") raw.saved.reverse = expected;
        else if (suffix === "box") raw.saved.box = expected;
        else if (suffix === "cert") raw.saved.certificate = expected;
      }
      updated++;
      console.log(`  ${fileName}: ${key} "${current || "null"}" → "${expected}"`);
    }
  }

  if (updated > 0) {
    raw.coin = coin;
    fs.writeFileSync(fullPath, JSON.stringify(raw, null, 2), "utf8");
  }
  return { updated, skipped: false };
}

function main() {
  const files = fs
    .readdirSync(DATA_DIR)
    .filter((f) => f.startsWith("perth-mint-") && f.endsWith(".json"));

  let totalUpdated = 0;
  let touchedFiles = 0;

  for (const f of files) {
    const { updated } = fixImagesForFile(f);
    if (updated > 0) {
      totalUpdated += updated;
      touchedFiles++;
    }
  }

  console.log(`\nГотово. Обновлено полей: ${totalUpdated} в файлах: ${touchedFiles}.`);
  console.log("Дальше: node scripts/update-perth-from-canonical-json.js → npm run data:export:incremental → npm run build.");
}

main();

