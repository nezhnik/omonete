/**
 * Создаёт отдельный файл с только теми строками из weight-issues.csv,
 * где есть твои комментарии / эмодзи (✅).
 *
 * Вход:  weight-issues.csv
 * Выход: weight-issues-commented.csv (в той же папке)
 *
 * В выходной файл попадает:
 * - первая строка (header),
 * - все строки, содержащие символ "✅".
 */

/* eslint-disable no-console */

const fs = require("fs");
const path = require("path");

const SRC = path.join(__dirname, "..", "weight-issues.csv");
const DST = path.join(__dirname, "..", "weight-issues-commented.csv");

function main() {
  if (!fs.existsSync(SRC)) {
    console.error("Файл не найден:", SRC);
    process.exit(1);
  }
  const text = fs.readFileSync(SRC, "utf8");
  const lines = text.split(/\r?\n/);
  if (!lines.length) {
    console.error("weight-issues.csv пустой.");
    process.exit(1);
  }

  const header = lines[0];
  const data = lines.slice(1);

  const commented = data.filter((l) => l.includes("✅"));

  const outLines = [header, ...commented];
  fs.writeFileSync(DST, outLines.join("\n"), "utf8");
  console.log("Сохранён файл с комментариями:", DST);
  console.log("Строк с комментариями:", commented.length);
}

main();

