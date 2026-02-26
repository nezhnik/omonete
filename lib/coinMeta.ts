/**
 * Убирает пробу из строки металла из БД (там часто "серебро 925/1000").
 * Возвращает только название металла с заглавной буквы, проба остаётся в metal_fineness.
 */
export function metalOnly(str: string | null | undefined): string {
  if (!str || typeof str !== "string") return "—";
  const cleaned = str.replace(/\s*\d{3,4}(\/\d{3,4})?\s*/g, "").trim();
  if (!cleaned) return "—";
  return cleaned.charAt(0).toUpperCase() + cleaned.slice(1).toLowerCase();
}
