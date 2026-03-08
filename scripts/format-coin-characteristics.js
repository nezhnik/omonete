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

/** Округление до 1 знака после запятой: 31.107 → 31.1. Для диаметра, толщины и т.д. */
function roundSpec(value) {
  if (value == null || value === "") return null;
  const n = typeof value === "number" ? value : parseFloat(String(value).replace(",", "."));
  if (Number.isNaN(n)) return null;
  return Math.round(n * 10) / 10;
}

/** Стандартные веса (г), которые показываем как есть. 0.031 — 1/1000 унции, 0.31 — 1/100 унции, 1 — 1 грамм. */
const CANONICAL_WEIGHT_G = [0.031, 0.156, 0.31, 1, 1.55, 3.11, 3.56, 3.89, 6.22, 7.78, 15.55, 31.1, 62.2, 155.5, 311, 311.1, 1000, 3000, 5000];

/** Округлённые с сайта (1 знак) → канонический вес: 7.8 → 7.78, 15.6 → 15.55. Для всех монет Perth и др. */
const ROUNDED_WEIGHT_TO_CANONICAL = { 7.8: 7.78, 15.6: 15.55 };

/** Вес для хранения: 15.553 → 15.55 (канонический), 31.107 → 31.1, 7.8 → 7.78; иначе до 2 знаков. Не округлять до 1 знака (15.6). */
function normalizeWeightG(value) {
  if (value == null || value === "") return null;
  const n = typeof value === "number" ? value : parseFloat(String(value).replace(",", "."));
  if (Number.isNaN(n)) return null;
  const rounded1 = Math.round(n * 10) / 10;
  if (ROUNDED_WEIGHT_TO_CANONICAL[rounded1] !== undefined) return ROUNDED_WEIGHT_TO_CANONICAL[rounded1];
  for (const c of CANONICAL_WEIGHT_G) {
    if (Math.abs(n - c) < 0.01) return c;
  }
  return Math.round(n * 100) / 100;
}

/** Вес в граммах для отображения: 31.1035 → 31.1, 15.55 и 7.78 не округляем; 7.8 → 7.78. */
function formatWeightG(value) {
  if (value == null || value === "") return null;
  const n = typeof value === "number" ? value : parseFloat(String(value).replace(",", "."));
  if (Number.isNaN(n)) return null;
  const rounded1 = Math.round(n * 10) / 10;
  if (ROUNDED_WEIGHT_TO_CANONICAL[rounded1] !== undefined) return String(ROUNDED_WEIGHT_TO_CANONICAL[rounded1]);
  for (const c of CANONICAL_WEIGHT_G) {
    if (Math.abs(n - c) < 0.01) return String(c);
  }
  const r = Math.round(n * 10) / 10;
  return r === Math.floor(r) ? String(Math.round(r)) : String(r);
}

/**
 * Металл, вес (г, унции) и качество из названия монеты (напр. "1/4oz Gold Proof" → Золото, 7.78, "1/4").
 * Используется при fetch Perth и при обновлении записей из title (без хардкода).
 */
function deriveMetalAndWeightFromTitle(title) {
  if (!title || typeof title !== "string") return {};
  const t = String(title);
  const isGold = /\bgold\b/i.test(t) && !/gold-plated|silver\b/i.test(t);
  const metal = isGold ? "Золото" : "Серебро";
  let weightOz = 1;
  let weightG = isGold ? 31.1 : 31.107;
  if (/\b1\/2\s*oz|½\s*oz|0\.5\s*oz|half\s*oz/i.test(t)) {
    weightOz = "1/2";
    weightG = 15.55;
  } else if (/\b1\/4\s*oz|1\/4oz|¼\s*oz|quarter\s*oz/i.test(t)) {
    weightOz = "1/4";
    weightG = 7.78;
  } else if (/\b1\/5\s*oz|1\/5oz|1-5oz/i.test(t)) {
    weightOz = "1/5";
    weightG = 6.22;
  } else if (/\b0\.5\s*g|\b0,5\s*g|\b1\/2\s*g\b/i.test(t)) {
    weightOz = "1/62,2";
    weightG = 0.5;
  } else if (/\b1\/10\s*oz|1\/10oz|1\/20\s*oz|1\/20oz/i.test(t)) {
    weightOz = /\b1\/20\b/i.test(t) ? "1/20" : "1/10";
    weightG = /\b1\/20\b/i.test(t) ? 1.55 : 3.11;
  } else if (/\b2\s*oz|2oz/i.test(t)) {
    weightOz = 2;
    weightG = 62.2;
  } else if (/\b1\s*kg|1kg|1\s*kilo|1000\s*g/i.test(t)) {
    weightOz = "1 кг";
    weightG = 1000;
  } else if (/\b3\s*kg|3kg|3\s*kilo/i.test(t)) {
    weightOz = "3 кг";
    weightG = 3000;
  } else if (/\b5\s*kg|5kg|5\s*kilo/i.test(t)) {
    weightOz = "5 кг";
    weightG = 5000;
  }
  const quality = /\bcoloured|colored\b/i.test(t) ? "Proof, Coloured" : "Proof";
  return { metal, weight_g: weightG, weight_oz: weightOz, quality };
}

/**
 * Страна из поля Legal Tender на сайте Perth Mint: Tuvalu → Тувалу, Australia/Australian → Австралия.
 */
function normalizeLegalTender(legalTender) {
  if (legalTender == null || String(legalTender).trim() === "") return null;
  const s = String(legalTender).trim();
  if (/^Tuvalu$/i.test(s)) return "Тувалу";
  if (/^Australia(n)?$/i.test(s)) return "Австралия";
  if (/^Cook\s*Islands$/i.test(s)) return "Острова Кука";
  if (/^Niue$/i.test(s)) return "Ниуэ";
  if (/^United\s*Kingdom$/i.test(s) || /^UK$/i.test(s)) return "Великобритания";
  return s;
}

/**
 * Номинал для поля face_value: число + "доллар/доллара/долларов" + " (страна)".
 * Для Великобритании: 0.5 → "50 пенсов (Великобритания)", 1 → "1 фунт (Великобритания)".
 */
function formatDenominationForFaceValue(amount, countryRu) {
  if (amount == null || countryRu == null || String(countryRu).trim() === "") return null;
  const n = typeof amount === "number" ? amount : parseFloat(String(amount).replace(",", "."));
  if (Number.isNaN(n) || n < 0) return null;
  if (/^Великобритания$/i.test(countryRu)) {
    if (n === 0.5) return "50 пенсов (Великобритания)";
    if (n === 1) return "1 фунт (Великобритания)";
    if (n < 1) return (n * 100) + " пенсов (Великобритания)";
    return n + " фунтов (Великобритания)";
  }
  const int = Math.floor(n);
  const mod10 = int % 10;
  const mod100 = int % 100;
  let word = "долларов";
  if (mod100 >= 11 && mod100 <= 14) word = "долларов";
  else if (mod10 === 1) word = "доллар";
  else if (mod10 >= 2 && mod10 <= 4) word = "доллара";
  const numStr = n === int ? String(int) : String(n).replace(".", ",");
  return `${numStr} ${word} (${countryRu})`;
}

/**
 * Страна эмитента из номинала: "1 доллар (Тувалу)" → "Тувалу". Если в номинале указана страна — её и ставим.
 */
function countryFromFaceValue(faceValue) {
  if (!faceValue || typeof faceValue !== "string") return null;
  const s = String(faceValue).trim();
  const m = s.match(/\(([^)]+)\)\s*$/); // скобки в конце: "(Тувалу)" или "(Tuvalu)"
  if (!m) return null;
  const name = m[1].trim();
  if (/^Тувалу$/i.test(name) || /^Tuvalu$/i.test(name)) return "Тувалу";
  if (/^Австралия$/i.test(name) || /^Australia$/i.test(name)) return "Австралия";
  if (/^Острова Кука$/i.test(name) || /^Cook Islands$/i.test(name)) return "Острова Кука";
  return name; // как в номинале
}

/** Убирает страну из номинала для отображения: "1 доллар (Тувалу)" → "1 доллар" (страна уже в отдельном поле). */
function stripCountryFromFaceValue(faceValue) {
  if (!faceValue || typeof faceValue !== "string") return null;
  const s = String(faceValue).trim();
  return s.replace(/\s*\([^)]+\)\s*$/, "").trim() || s;
}

/** Год из названия монеты (например "Baby Horse 2026" → 2026). */
function yearFromTitle(title) {
  if (title == null || title === "") return null;
  const s = String(title).replace(/\s+/g, " ").trim();
  const m = s.match(/(?:^|\s)(20\d{2}|19\d{2})(?:\s|$|[^\d])/);
  return m ? parseInt(m[1], 10) : null;
}

module.exports = { formatPurity, formatSpaceBeforeParen, formatMass, roundSpec, normalizeWeightG, formatWeightG, deriveMetalAndWeightFromTitle, normalizeLegalTender, formatDenominationForFaceValue, countryFromFaceValue, stripCountryFromFaceValue, yearFromTitle };
