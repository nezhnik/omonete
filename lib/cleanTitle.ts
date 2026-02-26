/**
 * Убирает из названия монеты HTML-теги и сущности (с сайта ЦБ: <nobr>, &nbsp;).
 * Пример: "Писатель И.А. Бунин, к&nbsp;<nobr>150-летию</nobr> со дня рождения" → "Писатель И.А. Бунин, к 150-летию со дня рождения"
 */
export function cleanCoinTitle(title: string | null | undefined): string {
  if (title == null || typeof title !== "string") return "";
  return title
    .replace(/<nobr>/gi, "")
    .replace(/<\/nobr>/gi, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}
