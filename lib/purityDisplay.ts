/**
 * Отображение пробы на сайте: только цифры, десятичная точка и дробь вида «9 999 / 10 000»
 * (без слов Gold, Silver и т.п.).
 */

const METAL_WORDS =
  /\b(silver|gold|platinum|palladium|copper|nickel|steel|ag|au|pt|pd|fine|pure|проба|металл|серебро|золото|платин|паллад|медь|никель|карат|carat|karat)\b/gi;

function groupInt(digitStr: string): string {
  return digitStr.replace(/\B(?=(\d{3})+(?!\d))/g, " ");
}

/**
 * Возвращает строку для UI или null, если из исходника не удаётся извлечь пробу.
 */
export function formatPurityDisplay(raw: string | undefined | null): string | null {
  if (raw == null || typeof raw !== "string") return null;
  let t = String(raw).trim().replace(/,/g, ".").replace(/‰/g, "");
  if (!t) return null;

  const frac = t.match(/(\d[\d\s]*)\s*\/\s*(\d[\d\s]*)/);
  if (frac) {
    const num = frac[1].replace(/\s/g, "");
    const den = frac[2].replace(/\s/g, "");
    if (/^\d+$/.test(num) && /^\d+$/.test(den)) {
      return `${groupInt(num)} / ${groupInt(den)}`;
    }
  }

  let cleaned = t.replace(METAL_WORDS, " ");
  cleaned = cleaned.replace(/[^0-9./\s]/g, " ").replace(/\s+/g, " ").trim();
  if (!cleaned) return null;

  const frac2 = cleaned.match(/^(\d+)\s*\/\s*(\d+)$/);
  if (frac2) return `${groupInt(frac2[1])} / ${groupInt(frac2[2])}`;

  const mDec = cleaned.match(/\b(\d+\.\d{1,4})\b/);
  if (mDec) {
    const [intPart, dec] = mDec[1].split(".");
    return `${groupInt(intPart)}.${dec}`;
  }

  const ints = cleaned.match(/\b\d{3,5}\b/g);
  if (ints?.length) {
    const nums = ints.map((x) => parseInt(x, 10)).filter((n) => n >= 100 && n <= 100000);
    if (nums.length) return groupInt(String(Math.max(...nums)));
  }

  const m2 = cleaned.match(/\b(\d{2,3})\b/);
  if (m2) {
    const n = parseInt(m2[1], 10);
    if (n >= 90 && n <= 999) return m2[1];
  }

  return null;
}
