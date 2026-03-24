/**
 * Единая нормализация title/subtitle Germania Mint (артефакты парсинга).
 * Используется: import-germania-mint-to-db.js, export-coins-to-json.js, sanitize-germania-mint-json-titles.js
 */
function sanitizeGermaniaMintTitle(s) {
  if (s == null || typeof s !== "string") return "";
  return s
    .replace(/\bWe value your privacy\b/gi, "")
    .replace(/\s+(?:Obverse|Awers):\s*.+$/i, "")
    .replace(
      /(?:^|\s)Germania Mint Sp\.\s*z\s*o\.?\s*o\.?\s+Al\.\s*Wojska Polskiego\s+\d+[\s\d-]*Jelenia\s+G[óo]ra\s+Poland\b/gi,
      " "
    )
    .replace(/^(Interkosmos:\s*Gagarin\s+1\s*oz\s+Silver\s+BU)\s+Yuri\s+Gagarin[\s\S]*$/i, "$1")
    .replace(/^Yuri\s+Gagarin\s+flew[\s\S]*$/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

module.exports = { sanitizeGermaniaMintTitle };
