/**
 * Выводит список монет из KOOKABURRA_SERIES_PLAN.md,
 * для которых ещё НЕТ картинок (has_images пустой).
 *
 * Ничего не изменяет, только читает файл и печатает
 * человекочитаемый список: секция → год, type, variant, title.
 *
 * Запуск:
 *   node scripts/list-kookaburra-missing-images.js
 */

/* eslint-disable no-console */

const fs = require("fs");
const path = require("path");

const PLAN_PATH = path.join(
  "/Users/mihail/Desktop/В IT работа",
  "documentation-backup",
  "important-documentation",
  "KOOKABURRA_SERIES_PLAN.md"
);

function main() {
  const text = fs.readFileSync(PLAN_PATH, "utf8");
  const lines = text.split(/\r?\n/);

  let currentSection = "";
  const result = [];

  for (const line of lines) {
    if (line.startsWith("## ")) {
      currentSection = line.replace(/^##\s*/, "").trim();
      continue;
    }

    if (!line.startsWith("|")) continue;
    if (line.startsWith("| year")) continue;
    if (line.startsWith("|------")) continue;

    const cells = line
      .split("|")
      .slice(1, -1)
      .map((c) => c.trim());

    // Ожидаем формат с 16 колонками:
    // year, type, variant, title, denomination, metal, fineness, weight_oz,
    // mintage, perth_url, reference_url, image_main_url, image_saved_paths,
    // has_images, status, notes
    if (cells.length !== 16) continue;

    const [year, type, variant, title] = cells;
    const hasImages = cells[13];

    if (!hasImages) {
      result.push({
        section: currentSection,
        year,
        type,
        variant,
        title,
      });
    }
  }

  console.log("Монеты без картинок (has_images пустой):", result.length);
  let lastSection = "";
  for (const item of result) {
    if (item.section && item.section !== lastSection) {
      console.log(`\n== ${item.section} ==`);
      lastSection = item.section;
    }
    const v = item.variant ? `, variant=${item.variant}` : "";
    const t = item.title || "";
    console.log(
      `- ${item.year}: type=${item.type}${v}${t ? ` — ${t}` : ""}`
    );
  }
}

main();

