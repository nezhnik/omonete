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
 * записываем MINTAGE_UNKNOWN_DISPLAY, чтобы монета не отфильтровывалась в export-coins-to-json.js
 * и было видно, что данные нужно добрать вручную.
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

module.exports = {
  MINTAGE_UNKNOWN_DISPLAY,
  finalizeMintageForDb,
  coinNeedsMintageResearch,
  logImportMintageSummary,
};
