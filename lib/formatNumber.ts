const NBSP = "\u00A0";

/** Отбивка тысяч/миллионов пробелом: 1533 → "1 533", 1_500_000 → "1 500 000" */
export function formatNumber(n: number): string {
  return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, NBSP);
}

/** В строках вроде "5000 гр." числа от 4 цифр форматируются с пробелом: "5 000 гр." */
export function formatNumbersInString(s: string): string {
  return s.replace(/\d{4,}/g, (m) => m.replace(/\B(?=(\d{3})+(?!\d))/g, NBSP));
}
