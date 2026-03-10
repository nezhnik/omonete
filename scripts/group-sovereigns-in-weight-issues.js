/**
 * Группирует соверены в weight-issues.csv в отдельный блок.
 *
 * Логика:
 * - Читаем weight-issues.csv.
 * - Первая строка (header) остаётся.
 * - Строки, где в названии есть "Sovereign" (без учёта регистра),
 *   собираем в отдельный массив.
 * - Перезаписываем файл в порядке:
 *   - header
 *   - строка-заголовок "sovereign";"";"";""
 *   - все строки соверенов (в исходном порядке)
 *   - пустая строка
 *   - остальные строки (как были).
 *
 * Запуск:
 *   node scripts/group-sovereigns-in-weight-issues.js
 */

/* eslint-disable no-console */

const fs = require("fs");
const path = require("path");

const CSV_PATH = path.join(__dirname, "..", "weight-issues.csv");

function main() {
  if (!fs.existsSync(CSV_PATH)) {
    console.error("Файл не найден:", CSV_PATH);
    process.exit(1);
  }

  const text = fs.readFileSync(CSV_PATH, "utf8");
  const lines = text.split(/\r?\n/);
  if (!lines.length) {
    console.error("weight-issues.csv пустой.");
    process.exit(1);
  }

  const header = lines[0];
  const data = lines.slice(1).filter((l) => l.trim() !== "");

  const sovereigns = [];
  const others = [];

  for (const line of data) {
    // Пропускаем уже существующие групповые строки (other, 0.1oz, 1oz и т.п.)
    if (/^"(other|\d+(\.\d+)?oz)";"";"";""$/.test(line)) {
      others.push(line);
      continue;
    }
    const lower = line.toLowerCase();
    if (lower.includes("sovereign")) {
      sovereigns.push(line);
    } else {
      others.push(line);
    }
  }

  const outLines = [header];

  if (sovereigns.length) {
    outLines.push("\"sovereign\";\"\";\"\";\"\"");
    outLines.push(...sovereigns);
    outLines.push(""); // пустая строка после блока
  }

  outLines.push(...others);

  fs.writeFileSync(CSV_PATH, outLines.join("\n"), "utf8");
  console.log("Перегруппировал weight-issues.csv. Соверены:", sovereigns.length);
}

main();

