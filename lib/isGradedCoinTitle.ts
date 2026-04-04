/**
 * Слэбы / грейдинг в названии — как в import-royaldutch / import-herdenkings (isGradedTitle).
 * На сайте такие позиции скрываем из каталога и поиска, в БД не трогаем.
 */
export function isGradedCoinTitle(...parts: (string | null | undefined)[]): boolean {
  const s = parts.flatMap((p) => (p == null || String(p) === "" ? [] : String(p))).join(" ").toLowerCase();
  if (!s) return false;
  return (
    /\bngc\b/.test(s) ||
    /\bpcgs\b/.test(s) ||
    /\b(ms|pf|pr)\s*-?\d{2}\b/.test(s) ||
    /\b(ms|pf|pr)\d{2}\b/.test(s)
  );
}
