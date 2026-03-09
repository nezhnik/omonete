/**
 * Убирает префикс "chards-" из колонки image_main_url
 * в файле KOOKABURRA_SERIES_PLAN.md, чтобы в плане
 * оставались только нейтральные названия монет.
 *
 * ВАЖНО:
 *  - Путь к реальным файлам НЕ трогаем
 *    (колонка image_saved_paths остаётся как есть),
 *    чтобы ничего не сломать.
 *
 * Запуск:
 *   node scripts/clean-kookaburra-image-main-slugs.js
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

  const out = [];
  let changed = 0;

  for (const line of lines) {
    if (!line.startsWith("|") || !line.includes("chards-")) {
      out.push(line);
      continue;
    }

    const parts = line.split("|");
    // убираем крайние пустые элементы
    const cells = parts.slice(1, -1).map((c) => c.trim());

    // ожидаем 16 колонок таблицы
    if (cells.length !== 16) {
      out.push(line);
      continue;
    }

    const imageMain = cells[11];
    if (imageMain && imageMain.startsWith("chards-")) {
      cells[11] = imageMain.replace(/^chards-/, "");
      changed += 1;
    }

    const newLine = `| ${cells.join(" | ")} |`;
    out.push(newLine);
  }

  fs.writeFileSync(PLAN_PATH, out.join("\n"), "utf8");
  console.log("Строк с очищенным image_main_url:", changed);
}

main();

