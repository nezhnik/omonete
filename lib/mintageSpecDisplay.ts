import { formatNumber } from "./formatNumber";

/**
 * Значение для подписи «Тираж, шт.» — только содержимое ячейки (без повтора слова «Тираж»).
 * Числа: «7 500», «до 7 500»; безлимит: «Неограничен».
 */
export function formatMintageSpecValue(mintageDisplay?: string | null, mintage?: number | null): string {
  const d =
    mintageDisplay != null && String(mintageDisplay).trim() !== ""
      ? normalizeMintageDisplayCell(String(mintageDisplay))
      : "";
  if (d !== "") return d;
  if (mintage != null && Number.isFinite(Number(mintage))) return formatNumber(Number(mintage));
  return "";
}

function normalizeMintageDisplayCell(raw: string): string {
  let t = raw.replace(/\s+/g, " ").trim();
  // Снять ведущее «Тираж», «Тираж, шт.» — подпись уже слева в UI
  t = t.replace(/^тираж\s*,\s*шт\.?\s*/iu, "").trim();
  t = t.replace(/^тираж\s+/iu, "").trim();
  if (/^unlimited$/iu.test(t)) return "Неограничен";
  if (/^неограничен$/iu.test(t)) return "Неограничен";
  if (/неограниченный\s+тираж/iu.test(t)) return "Неограничен";
  if (/неограничен/i.test(t) && !/\d/.test(t)) return "Неограничен";
  return t;
}
