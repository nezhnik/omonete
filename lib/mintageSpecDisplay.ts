import { formatNumber } from "./formatNumber";

/**
 * Значение для подписи «Тираж, шт.» — только содержимое ячейки (без повтора слова «Тираж»).
 * Числа: «7 500», «до 7 500»; безлимит: «Неограничен».
 */
export function formatMintageSpecValue(mintageDisplay?: string | null, mintage?: number | null): string {
  const mNum = mintage != null ? Number(mintage) : NaN;
  const hasMintage = Number.isFinite(mNum) && mNum > 0;

  const rawDisp = mintageDisplay != null ? String(mintageDisplay).trim() : "";
  const d = rawDisp !== "" ? normalizeMintageDisplayCell(rawDisp) : "";

  /** mintage_display часто обрезан или начинается с номинала («20 Swiss francs») — не подменять числовой тираж из БД. */
  if (hasMintage) {
    const parsedDisp = d ? Number(String(d).replace(/\s/g, "").replace(/\u00a0/g, "")) : NaN;
    const tol = Math.max(1, Math.floor(mNum * 0.02));
    const displayMatches =
      Number.isFinite(parsedDisp) && parsedDisp > 0 && Math.abs(parsedDisp - mNum) <= tol;
    if (!d || !Number.isFinite(parsedDisp) || !displayMatches) return formatNumber(mNum);
    return d;
  }

  if (d !== "") return d;
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
  // Для каталога/деталей — одно число с разделением тысяч. Нельзя склеивать ВСЕ цифры строки:
  // «4,750 units … 250 units» давало 4 750 250 вместо 4 750.
  const leadUnits = t.match(/^([\d\s''’.,]+)\s+units\b/i);
  if (leadUnits) {
    const normalized = leadUnits[1].replace(/[\s''’']/g, "").replace(/\./g, "").replace(/,/g, "");
    const n = Number(normalized);
    if (Number.isFinite(n) && n > 0 && n < 1e9) return formatNumber(n);
  }
  // «1925 Mintage: 5,000 units …» — не брать год как тираж
  const mintageColonUnits = t.match(/\bMintage:\s*([\d\s''’.,]+)\s+units\b/i);
  if (mintageColonUnits) {
    const normalized = mintageColonUnits[1].replace(/[\s''’']/g, "").replace(/\./g, "").replace(/,/g, "");
    const n = Number(normalized);
    if (Number.isFinite(n) && n > 0 && n < 1e9) return formatNumber(n);
  }
  const firstNumM = t.match(/\b(\d{1,3}(?:[,\s]\d{3})+|\d{2,7})\b/);
  if (firstNumM) {
    const n = Number(firstNumM[1].replace(/[\s,]/g, ""));
    if (Number.isFinite(n) && n > 0 && n < 1e9) return formatNumber(n);
  }
  return t;
}
