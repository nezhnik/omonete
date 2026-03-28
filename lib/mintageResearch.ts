/**
 * Синхронно с scripts/parsing-mintage-constants.js — при смене правил обновлять оба места.
 * См. docs/PARSING-MINTAGE.md
 */
export const MINTAGE_UNKNOWN_DISPLAY = "Тираж не указан";

export function coinNeedsMintageResearch(row: {
  mintage?: unknown;
  mintage_display?: unknown;
  mintageDisplay?: unknown;
}): boolean {
  const hasNum = row.mintage != null && Number(row.mintage) !== 0;
  if (hasNum) return false;
  const d = String(row.mintage_display ?? row.mintageDisplay ?? "").trim();
  if (!d) return true;
  return d === MINTAGE_UNKNOWN_DISPLAY;
}
