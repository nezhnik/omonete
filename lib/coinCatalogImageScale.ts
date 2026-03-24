/**
 * Точечный масштаб отображения: у части монет в webp большой «воздух» вокруг круга —
 * в сетке каталога выглядят меньше соседей. Только UI, файлы не трогаем.
 * Ключ — id монеты из каталога.
 */
export const COIN_CATALOG_CARD_IMAGE_SCALE: Record<string, number> = {
  /** Allegories: Polonia & Germania 2 oz WMF 2023 — визуально меньше 1 oz из-за полей в файле */
  "6404": 1.22,
};

/** Главное фото на странице монеты (холст уже крупнее — масштаб обычно меньше). */
export const COIN_DETAIL_MAIN_IMAGE_SCALE: Record<string, number> = {
  "6404": 1.12,
};
