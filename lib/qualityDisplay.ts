/**
 * Отображение качества чеканки на русском и английском (как на ЦБ).
 * Все значения с большой буквы: Пруф-лайк / Proof-like.
 */
const QUALITY_MAP: Array<{ pattern: RegExp; label: string }> = [
  { pattern: /^пруф$/i, label: "Пруф / Proof" },
  { pattern: /^proof$/i, label: "Пруф / Proof" },
  { pattern: /^ац$/i, label: "АНЦ / Uncirculated" },
  { pattern: /^uncirculated$/i, label: "АНЦ / Uncirculated" },
  { pattern: /улучшенный|бац|brilliant\s*uncirculated/i, label: "Улучшенный Анциркулейтед / Brilliant Uncirculated" },
  { pattern: /пруф-лайк|proof-like/i, label: "Пруф-лайк / Proof-like" },
];

function capitalizeQuality(s: string): string {
  return s
    .split(" / ")
    .map((part) => {
      const t = part.trim();
      return t.charAt(0).toUpperCase() + t.slice(1).toLowerCase();
    })
    .join(" / ");
}

export function formatQualityDisplay(quality: string | null | undefined): string {
  if (quality == null || typeof quality !== "string") return "";
  const q = quality.trim();
  if (!q) return "";
  for (const { pattern, label } of QUALITY_MAP) {
    if (pattern.test(q)) return label;
  }
  return capitalizeQuality(q);
}
