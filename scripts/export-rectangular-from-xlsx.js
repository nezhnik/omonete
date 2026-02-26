/**
 * Извлекает из xlsx каталога колонку rectangular и сохраняет catalog_number в rectangular-coins.json.
 * Используется при экспорте: монеты из этого списка не обрезаются по кругу (квадратные/прямоугольные).
 *
 * Запуск: node scripts/export-rectangular-from-xlsx.js
 *   Файл: RC_F01_01_1992_T06_02_2026-2.xlsx в корне omonete-app
 *   Или: node scripts/export-rectangular-from-xlsx.js <путь к xlsx>
 */
const X = require("xlsx");
const path = require("path");
const fs = require("fs");

const defaultPath = path.join(__dirname, "..", "RC_F01_01_1992_T06_02_2026-2.xlsx");
const xlsxPath = process.argv[2] || defaultPath;

const OUT_PATH = path.join(__dirname, "..", "rectangular-coins.json");

function isRectangular(val) {
  if (val == null) return false;
  const s = String(val).trim().toLowerCase();
  if (s === "1" || s === "да" || s === "yes" || s === "true" || s === "x" || s === "+") return true;
  if (!Number.isNaN(parseFloat(s)) && parseFloat(s) !== 0) return true;
  return false;
}

function run() {
  if (!fs.existsSync(xlsxPath)) {
    console.error("Файл не найден:", xlsxPath);
    process.exit(1);
  }

  const wb = X.readFile(xlsxPath);
  const sh = wb.Sheets[wb.SheetNames[0]];
  const rows = X.utils.sheet_to_json(sh, { header: 1, raw: false });
  const headers = (rows[0] || []).map((h) => String(h ?? "").trim());

  const colCatalog = headers.findIndex((h) => /part_number|catalog|каталожный|номер/i.test(h));
  const colRect = headers.findIndex((h) => /rectangular|прямоуг|квадрат|форма/i.test(h));

  const catalogIdx = colCatalog >= 0 ? colCatalog : 0;
  const rectIdx = colRect >= 0 ? colRect : -1;

  if (rectIdx < 0) {
    console.warn("Колонка rectangular не найдена. Заголовки:", headers.slice(0, 12).join(" | "));
    console.warn("Ожидаются названия типа: rectangular, прямоугольная, квадратная, форма");
    fs.writeFileSync(OUT_PATH, JSON.stringify([], null, 2));
    console.log("Создан пустой rectangular-coins.json");
    return;
  }

  const catalogNumbers = [];
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    const catalog = row[catalogIdx] != null ? String(row[catalogIdx]).trim() : "";
    const rectVal = row[rectIdx];
    if (catalog && isRectangular(rectVal)) {
      catalogNumbers.push(catalog);
    }
  }

  const uniq = [...new Set(catalogNumbers)].sort();
  fs.writeFileSync(OUT_PATH, JSON.stringify(uniq, null, 2));
  console.log("✓ rectangular-coins.json —", uniq.length, "монет (catalog_number)");
}

run();
