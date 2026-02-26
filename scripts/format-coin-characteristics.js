/**
 * Форматирование характеристик монет для единообразного хранения в БД.
 * Используется при записи в БД и в скрипте нормализации существующих данных.
 */

/** Проба: пробелы вокруг слеша — 925/1000 → 925 / 1000 */
function formatPurity(s) {
  if (s == null || typeof s !== "string") return "";
  return s.replace(/\s*\/\s*/g, " / ").trim();
}

/** Перед скобкой пробел: 22,60(±0,15) → 22,60 (±0,15) */
function formatSpaceBeforeParen(s) {
  if (s == null || typeof s !== "string") return "";
  return s.replace(/([^\s])\(/g, "$1 (").trim();
}

/** Масса: десятичный разделитель запятая — 15.55 → 15,55 */
function formatMass(s) {
  if (s == null || typeof s !== "string") return "";
  return s.replace(".", ",").trim();
}

module.exports = { formatPurity, formatSpaceBeforeParen, formatMass };
