/**
 * Проставляет в KOOKABURRA_SERIES_PLAN.md ссылки на картинки и has_images
 * на основе данных, которые мы скачали с Chards (chards-kookaburra-raw.json).
 *
 * Идея:
 *  - из chards-kookaburra-raw.json собираем мапу по ключу "<weightKey>-<year>";
 *    weightKey: "1oz" | "2oz" | "10oz" | "1kg";
 *  - berём только те записи, у которых есть и reverse, и obverse;
 *  - в KOOKABURRA_SERIES_PLAN.md ищем строки таблиц:
 *      - Regular (1 oz Silver)
 *      - Regular (2 oz Silver)
 *      - Regular (10 oz Silver)
 *      - Regular (1 kg Silver)
 *    и если:
 *      - type = regular-<weightKey>
 *      - variant пустой
 *      - image_main_url и has_images пустые,
 *    то подставляем slug ревёрса и пути к rev/obv, has_images = "yes".
 *
 * Файл правим аккуратно: переписываем целиком, но только этот markdown.
 *
 * Запуск:
 *   node scripts/link-chards-images-to-kookaburra-plan.js
 */

/* eslint-disable no-console */

const fs = require("fs");
const path = require("path");

// План лежит в соседнем проекте "В IT работа"
const PLAN_PATH = path.join(
  "/Users/mihail/Desktop/В IT работа",
  "documentation-backup",
  "important-documentation",
  "KOOKABURRA_SERIES_PLAN.md"
);
const CHARDS_JSON = path.join(
  path.join(__dirname, ".."),
  "data",
  "chards-kookaburra-raw.json"
);

function detectWeightKeyFromSlug(slug) {
  const s = String(slug).toLowerCase();
  if (s.includes("1kg") || s.includes("one-kilo") || s.includes("one-kilogram")) {
    return "1kg";
  }
  if (s.includes("10-oz") || s.includes("10-ounce") || s.includes("ten-ounce")) {
    return "10oz";
  }
  if (s.includes("2oz") || s.includes("two-ounce") || s.includes("two-oz")) {
    return "2oz";
  }
  if (s.includes("1-oz") || s.includes("one-ounce")) {
    return "1oz";
  }
  return null;
}

function detectYearFromSlugOrUrl(str) {
  const m = String(str).match(/(19|20)\d{2}/);
  return m ? parseInt(m[0], 10) : null;
}

function buildChardsMap() {
  if (!fs.existsSync(CHARDS_JSON)) {
    console.log("Нет файла chards-kookaburra-raw.json, пропускаем.");
    return {};
  }
  const raw = JSON.parse(fs.readFileSync(CHARDS_JSON, "utf8"));
  const map = {};

  for (const entry of raw) {
    const { productUrl, slug, images } = entry;
    if (!images || !images.reverse || !images.obverse) continue;

    const weightKey =
      detectWeightKeyFromSlug(slug) || detectWeightKeyFromSlug(productUrl);
    const year = detectYearFromSlugOrUrl(productUrl) ||
      detectYearFromSlugOrUrl(slug);
    if (!weightKey || !year) continue;

    const key = `${weightKey}-${year}`;
    // если уже есть запись для этого ключа, остаёмся на первой — этого достаточно,
    // нам важно только "что у нас вообще есть картинки для этого веса/года".
    if (!map[key]) {
      map[key] = {
        year,
        weightKey,
        slug,
        reverse: images.reverse,
        obverse: images.obverse,
        productUrl,
      };
    }
  }

  return map;
}

function processPlan(chardsMap) {
  const text = fs.readFileSync(PLAN_PATH, "utf8");
  const lines = text.split(/\r?\n/);

  const weightKeyByType = {
    "regular-1oz": "1oz",
    "regular-2oz": "2oz",
    "regular-10oz": "10oz",
    "regular-1kg": "1kg",
  };

  const newLines = [];
  let changed = 0;

  for (const line of lines) {
    if (!line.startsWith("|")) {
      newLines.push(line);
      continue;
    }

    // Быстрый фильтр: интересуют только строки с regular-1oz/2oz/10oz/1kg
    if (
      !line.includes("regular-1oz") &&
      !line.includes("regular-2oz") &&
      !line.includes("regular-10oz") &&
      !line.includes("regular-1kg")
    ) {
      newLines.push(line);
      continue;
    }

    const cells = line
      .split("|")
      .slice(1, -1)
      .map((c) => c.trim());

    // Ожидаем формат с 16 колонками:
    // year, type, variant, title, denomination, metal, fineness, weight_oz,
    // mintage, perth_url, reference_url, image_main_url, image_saved_paths,
    // has_images, status, notes
    if (cells.length !== 16) {
      newLines.push(line);
      continue;
    }

    const [yearStr, type, variant] = cells;
    const imageMain = cells[11];
    const imageSaved = cells[12];
    const hasImages = cells[13];

    const weightKey = weightKeyByType[type];
    const year = parseInt(yearStr, 10);

    if (!weightKey || Number.isNaN(year)) {
      newLines.push(line);
      continue;
    }

    // Не трогаем privy/proof/etc — только базовые регулярные строки
    if (variant) {
      newLines.push(line);
      continue;
    }

    // Если уже стоят картинки или has_images, не меняем
    if (imageMain || imageSaved || hasImages) {
      newLines.push(line);
      continue;
    }

    const key = `${weightKey}-${year}`;
    const info = chardsMap[key];
    if (!info) {
      newLines.push(line);
      continue;
    }

    const mainSlug = info.slug;
    const revPath = info.reverse;
    const obvPath = info.obverse;

    cells[11] = mainSlug; // image_main_url
    cells[12] = `${revPath}, ${obvPath}`; // image_saved_paths
    cells[13] = "yes"; // has_images

    const updatedLine = `| ${cells.join(" | ")} |`;
    newLines.push(updatedLine);
    changed += 1;
  }

  fs.writeFileSync(PLAN_PATH, newLines.join("\n"), "utf8");
  console.log("Строк обновлено:", changed);
}

function main() {
  const chardsMap = buildChardsMap();
  console.log("Ключей в мапе Chards:", Object.keys(chardsMap).length);
  processPlan(chardsMap);
}

main();

