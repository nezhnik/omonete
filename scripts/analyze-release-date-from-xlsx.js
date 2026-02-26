/**
 * Анализ колонки даты в xlsx ЦБ: что за значение в row[1], почему у части монет год 2025/2026.
 * Запуск: node scripts/analyze-release-date-from-xlsx.js [путь к xlsx]
 *   По умолчанию: RC_F01_01_1992_T06_02_2026-2.xlsx (как в sync-from-cbr-xlsx.js)
 */
const X = require("xlsx");
const path = require("path");
const fs = require("fs");

const defaultPath = path.join(__dirname, "..", "RC_F01_01_1992_T06_02_2026-2.xlsx");
const xlsxPath = process.argv[2] || defaultPath;

if (!fs.existsSync(xlsxPath)) {
  console.error("Файл не найден:", xlsxPath);
  console.error("Укажите путь: node scripts/analyze-release-date-from-xlsx.js <path>");
  process.exit(1);
}

const wb = X.readFile(xlsxPath, { cellDates: false });
const sh = wb.Sheets[wb.SheetNames[0]];
const rows = X.utils.sheet_to_json(sh, { header: 1, raw: true });

const headers = rows[0] || [];
const col0Name = headers[0] != null ? String(headers[0]).trim() : "col0";
const col1Name = headers[1] != null ? String(headers[1]).trim() : "col1 (дата?)";
const col2Name = headers[2] != null ? String(headers[2]).trim() : "col2";

console.log("--- Заголовки (первые 6 колонок) ---");
console.log(headers.slice(0, 6));
console.log("  Колонка B (row[1]), которую мы используем как release_date:", col1Name);
console.log("");

const dataRows = rows.slice(1).filter((r) => r && r.length && r[2]);

// Строки «Георгий Победоносец» и номинал 3 рубля
const georgiy3 = dataRows.filter(
  (r) => (r[2] || "").includes("Георгий Победоносец") && (r[4] || "").includes("3 рубля")
);
console.log("--- Строки «Георгий Победоносец», 3 рубля (в xlsx) ---");
for (const r of georgiy3) {
  const rawDate = r[1];
  const type = rawDate === null || rawDate === undefined ? "null" : typeof rawDate;
  console.log("  catalog_number:", r[0], "| row[1] (сырое):", rawDate, "| тип:", type, "| title:", (r[2] || "").slice(0, 40));
  if (typeof rawDate === "number") {
    const asDate = new Date((rawDate - 25569) * 86400 * 1000);
    console.log("    → как дата Excel:", asDate.toISOString().slice(0, 10), "год:", asDate.getFullYear());
  }
}
console.log("");

// Уникальные годы из колонки B (если число — переводим в год)
const yearsFromCol1 = new Map();
let nullCount = 0;
for (const r of dataRows) {
  const v = r[1];
  if (v == null || v === "") {
    nullCount++;
    continue;
  }
  let year;
  if (typeof v === "number") {
    const d = new Date((v - 25569) * 86400 * 1000);
    year = isNaN(d.getTime()) ? "invalid" : d.getFullYear();
  } else {
    const d = new Date(v);
    year = isNaN(d.getTime()) ? String(v).slice(0, 20) : d.getFullYear();
  }
  yearsFromCol1.set(year, (yearsFromCol1.get(year) || 0) + 1);
}
console.log("--- Распределение по годам в колонке B (row[1]) ---");
const sorted = [...yearsFromCol1.entries()].sort((a, b) => {
  if (typeof a[0] === "number" && typeof b[0] === "number") return a[0] - b[0];
  return String(a[0]).localeCompare(String(b[0]));
});
for (const [y, count] of sorted) {
  console.log("  ", y, ":", count, "строк");
}
console.log("  (пусто/null):", nullCount);
console.log("");

// Если в колонке B много 2026 — вероятно, это не год выпуска, а конец периода каталога
const count2026 = yearsFromCol1.get(2026) || 0;
const count2025 = yearsFromCol1.get(2025) || 0;
if (count2026 > 0 || count2025 > 0) {
  console.log("--- Вывод ---");
  console.log("  В колонке B встречается год 2026:", count2026, "раз, 2025:", count2025, "раз.");
  console.log("  Если это каталог ЦБ на период до 02.2026, то в колонке B может быть");
  console.log("  не «год выпуска монеты», а «дата актуальности» или конец периода — тогда");
  console.log("  для старых монет (напр. Георгий Победоносец 2009) ошибочно подставляется 2026.");
}
