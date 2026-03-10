/**
 * Сливает старый weight-issues-prev.csv (с комментариями)
 * и новый weight-issues.csv (свежий отчёт), добавляя
 * в старый только НОВЫЕ монеты (по URL).
 *
 * Итог: перезаписывает weight-issues.csv объединённой версией.
 *
 * Запуск:
 *   node scripts/merge-weight-issues-append-new.js
 */

/* eslint-disable no-console */

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const PREV = path.join(ROOT, "weight-issues-prev.csv");
const CURR = path.join(ROOT, "weight-issues.csv");

function readLines(p) {
  return fs.readFileSync(p, "utf8").split(/\r?\n/);
}

function extractUrl(line) {
  if (!line.startsWith("\"http")) return null;
  const m = line.match(/^"([^"]+)"/);
  return m ? m[1] : null;
}

function main() {
  if (!fs.existsSync(PREV)) {
    console.error("Нет weight-issues-prev.csv — нечего сливать.");
    process.exit(1);
  }
  if (!fs.existsSync(CURR)) {
    console.error("Нет нового weight-issues.csv.");
    process.exit(1);
  }

  const prevLines = readLines(PREV);
  const currLines = readLines(CURR);

  if (!prevLines.length || !currLines.length) {
    console.error("Один из файлов пустой, отмена.");
    process.exit(1);
  }

  // Собираем множество URL, которые уже есть в старом файле
  const existing = new Set();
  for (let i = 1; i < prevLines.length; i++) {
    const url = extractUrl(prevLines[i]);
    if (url) existing.add(url);
  }

  const toAppend = [];

  for (let i = 1; i < currLines.length; i++) {
    const line = currLines[i];
    const url = extractUrl(line);
    if (!url) continue; // пропускаем заголовки групп и пустые строки
    if (existing.has(url)) continue;
    toAppend.push(line);
  }

  if (!toAppend.length) {
    console.log("Новых проблемных монет нет — файл не изменён.");
    return;
  }

  const merged = []
    .concat(prevLines)
    .concat([""])
    .concat(toAppend);

  fs.writeFileSync(CURR, merged.join("\n"), "utf8");
  console.log(
    "Готово. Добавлено новых строк:",
    toAppend.length,
    "→ weight-issues.csv расширен без потери комментариев."
  );
}

main();

