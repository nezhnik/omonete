/**
 * PDP Mennica, которые не ведём в каталог (аксессуары / упаковка).
 * Используют листинг, fetch и (при необходимости) delete из БД.
 */
function normalizeProductUrl(url) {
  if (!url || typeof url !== "string") return null;
  try {
    const u = new URL(url.trim());
    u.hash = "";
    u.search = "";
    return u.toString().replace(/\/+$/, "");
  } catch {
    return String(url).trim().replace(/\/+$/, "") || null;
  }
}

const RAW_EXCLUDED = [
  "https://inwestycje.mennica.com.pl/box-for-gold-bar",
  "https://inwestycje.mennica.com.pl/envelope",
];

const EXCLUDED_NORMALIZED = new Set(RAW_EXCLUDED.map(normalizeProductUrl).filter(Boolean));

function isExcludedMennicaProductUrl(url) {
  const n = normalizeProductUrl(url);
  return !!(n && EXCLUDED_NORMALIZED.has(n));
}

module.exports = {
  RAW_EXCLUDED,
  EXCLUDED_NORMALIZED,
  normalizeProductUrl,
  isExcludedMennicaProductUrl,
};
