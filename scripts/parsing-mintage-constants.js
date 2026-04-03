/**
 * Единые правила тиража при парсинге/импорте иностранных монет.
 * См. docs/PARSING-MINTAGE.md
 */
const MINTAGE_UNKNOWN_DISPLAY = "Тираж не указан";

function isRussiaCountry(country) {
  return /^Россия/i.test(String(country || "").trim());
}

/**
 * Для страны ≠ Россия: если нет числового тиража и нет осмысленного текста в mintage_display —
 * записываем MINTAGE_UNKNOWN_DISPLAY (каталог на сайте всё равно выводит монету; маркер для отчётов и coinNeedsMintageResearch).
 */
function finalizeMintageForDb(mintage, mintageDisplay, country) {
  if (isRussiaCountry(country)) {
    const d = mintageDisplay == null ? "" : String(mintageDisplay).trim();
    return { mintage, mintageDisplay: d || null };
  }
  const hasNum = mintage != null && Number(mintage) !== 0;
  const disp = mintageDisplay == null ? "" : String(mintageDisplay).trim();
  if (hasNum) return { mintage, mintageDisplay: disp || null };
  if (disp) return { mintage, mintageDisplay: disp };
  return { mintage, mintageDisplay: MINTAGE_UNKNOWN_DISPLAY };
}

/** Строка БД или объекта импорта: нужен ручной поиск тиража. */
function coinNeedsMintageResearch(row) {
  const hasNum = row.mintage != null && Number(row.mintage) !== 0;
  if (hasNum) return false;
  const d = String(row.mintage_display ?? row.mintageDisplay ?? "").trim();
  if (!d) return true;
  return d === MINTAGE_UNKNOWN_DISPLAY;
}

function logImportMintageSummary(sourceLabel, rows) {
  const total = rows.length;
  const gap = rows.filter((r) => coinNeedsMintageResearch(r)).length;
  console.log(`[тираж] ${sourceLabel}: без числового тиража (проверить в интернете / в данных) — ${gap} из ${total}`);
}

/**
 * Тираж из текста блока .product-description__text (и аналогов) на pamp.com.
 * Пример: «this coin has a mintage of 3,600.» — без слова «coins» после числа.
 */
function extractPampMintagePhraseFromPlainText(plain) {
  const descPlain = String(plain || "").replace(/\s+/g, " ").trim();
  if (!descPlain) return null;
  const norm = (chunk) => chunk.replace(/\s+/g, " ").replace(/[.,;]+$/, "").trim();
  const mintageCoins = descPlain.match(/\bmintage of (?:only\s+)?([\d,.\s]+)\s*coins?\b/i);
  if (mintageCoins) return norm(mintageCoins[1]);
  const mintagePieces = descPlain.match(/\bmintage of (?:only\s+)?([\d,.\s]+)\s*pieces?\b/i);
  if (mintagePieces) return norm(mintagePieces[1]);
  const mintageBars = descPlain.match(/\blimited mintage of\s*(?:only\s+)?([\d,.\s]+)\s*bars?\b/i);
  if (mintageBars) return norm(mintageBars[1]);
  const limitedPlain = descPlain.match(/\blimited mintage of\s*(?:only\s+)?([\d,.\s]+)\b/i);
  if (limitedPlain) return norm(limitedPlain[1]);
  const mintagePlain = descPlain.match(/\bmintage of (?:only\s+)?([\d,.\s]+)\b/i);
  if (mintagePlain) return norm(mintagePlain[1]);
  return null;
}

module.exports = {
  MINTAGE_UNKNOWN_DISPLAY,
  finalizeMintageForDb,
  coinNeedsMintageResearch,
  logImportMintageSummary,
  extractPampMintagePhraseFromPlainText,
};
