import { MINTAGE_UNKNOWN_DISPLAY } from "./mintageResearch";
import { formatMintageSpecValue } from "./mintageSpecDisplay";

/**
 * Показывать строку характеристики только при осмысленном значении
 * (не пусто, не «—», не маркер «не указан» из импорта, не один ноль как число).
 */
export function isMeaningfulSpecString(value: string | undefined | null): boolean {
  if (value == null) return false;
  const t = String(value).replace(/\u00A0/g, " ").trim();
  if (!t) return false;
  if (t === "—" || t === "-" || t === "\u2013") return false;
  if (t === MINTAGE_UNKNOWN_DISPLAY) return false;
  const il = t.toLowerCase();
  if (il === "номинал не указан") return false;
  if (il === "n/a" || il === "н/д") return false;
  if (/^0+([.,]0*)?$/i.test(t)) return false;
  return true;
}

/** Год выпуска: null/undefined и 0 в карточке не показываем. */
export function hasMeaningfulSpecYear(year: unknown): boolean {
  if (year == null || year === "") return false;
  const n = Number(year);
  return Number.isFinite(n) && n !== 0;
}

/**
 * Вес и размеры (гр., мм, подпись унции): пусто/плейсхолдер/числовой 0 скрываем;
 * строки вроде «1/10 унции» (NaN после Number) остаются.
 */
export function isMeaningfulDimensionOrWeight(value: string | undefined | null): boolean {
  if (!isMeaningfulSpecString(value)) return false;
  const t = String(value).replace(/\u00A0/g, " ").trim();
  const compact = t.replace(/\s/g, "").replace(",", ".");
  if (/^-?\d+(?:\.\d+)?$/i.test(compact)) {
    const n = Number(compact);
    if (Number.isFinite(n) && n === 0) return false;
  }
  return true;
}

/** Строка «Тираж, шт.» — только если есть число или непустое отформатированное текстовое значение. */
export function coinHasVisibleMintageForSpecRow(coin: { mintage?: number; mintageDisplay?: string }): boolean {
  const hasNum = coin.mintage != null && Number(coin.mintage) !== 0;
  if (hasNum) return true;
  const disp = coin.mintageDisplay;
  if (!isMeaningfulSpecString(disp)) return false;
  return Boolean(formatMintageSpecValue(disp, coin.mintage).trim());
}
