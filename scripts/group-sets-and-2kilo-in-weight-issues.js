/**
 * Дополнительная группировка в weight-issues.csv:
 * - блок sovereign (уже есть, не трогаем, если строка-заголовок присутствует);
 * - блок three-coin-set — все монеты, где в названии есть "Three-Coin Set" или "Three Coin Set";
 * - блок 2 kilo — все монеты, где в названии есть "2 Kilo" / "2 KILO" / "2kg".
 *
 * Формат файла сохраняем:
 * url;title;weight_g;weight_oz
 *
 * Порядок после обработки:
 * - header
 * - (если есть) существующий блок sovereign — остаётся как есть
 * - "three-coin-set";"";"";""
 *   <все three-coin-set>
 * - пустая строка
 * - "2kilo";"";"";""
 *   <все 2 kilo>
 * - пустая строка
 * - остальные строки.
 *
 * Запуск:
 *   node scripts/group-sets-and-2kilo-in-weight-issues.js
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
  const data = lines.slice(1);

  const resultLines = [header];

  // Если уже есть блок sovereign, просто копируем его наверх как есть
  // и работаем только с остальными строками.
  let idx = 1;
  if (data[0] && data[0].startsWith("\"sovereign\";")) {
    // копируем до первой пустой строки (включительно)
    while (idx < lines.length) {
      const line = lines[idx];
      resultLines.push(line);
      idx++;
      if (!line.trim()) break;
    }
  }

  const remaining = lines.slice(idx).filter((l) => l !== "");

  const threeCoin = [];
  const twoKilo = [];
  const others = [];

  const threeCoinRe = /three[-\s]coin set/i;
  const twoKiloRe = /2\s*kilo/i;
  const twoKgRe = /2\s*kg/i;

  for (const line of remaining) {
    if (!line.trim()) continue;
    // пропускаем существующие групповые строки other / 0.1oz / 1oz / sovereign / и т.п.
    if (/^"(other|\d+(\.\d+)?oz|sovereign)";"";"";""$/.test(line)) {
      others.push(line);
      continue;
    }
    const lower = line.toLowerCase();
    if (threeCoinRe.test(lower)) {
      threeCoin.push(line);
    } else if (twoKiloRe.test(lower) || twoKgRe.test(lower)) {
      twoKilo.push(line);
    } else {
      others.push(line);
    }
  }

  if (threeCoin.length) {
    resultLines.push("\"three-coin-set\";\"\";\"\";\"\"");
    resultLines.push(...threeCoin);
    resultLines.push("");
  }

  if (twoKilo.length) {
    resultLines.push("\"2kilo\";\"\";\"\";\"\"");
    resultLines.push(...twoKilo);
    resultLines.push("");
  }

  resultLines.push(...others);

  fs.writeFileSync(CSV_PATH, resultLines.join("\n"), "utf8");
  console.log("Группы:");
  console.log("  three-coin-set:", threeCoin.length);
  console.log("  2kilo:", twoKilo.length);
}

main();

