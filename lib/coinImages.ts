/**
 * Изображения только свои (из БД). URL ЦБ не используем — на сайте только монеты с залитыми картинками.
 */

/** Аверс: только путь из БД. */
export function obverseUrl(
  imageObverse: string | null | undefined,
  _catalogNumber?: string | null
): string | null {
  if (imageObverse && String(imageObverse).trim()) return imageObverse.trim();
  return null;
}

/** Реверс: только путь из БД. */
export function reverseUrl(
  imageReverse: string | null | undefined,
  _catalogNumber?: string | null
): string | null {
  if (imageReverse && String(imageReverse).trim()) return imageReverse.trim();
  return null;
}

/** Первое изображение для карточки: image_obverse, иначе image_urls[0]. Только свои пути. */
export function firstImageUrl(
  imageUrls: string[] | null | undefined,
  _catalogNumber: string | null | undefined,
  imageObverse?: string | null
): string | null {
  if (imageObverse && String(imageObverse).trim()) return imageObverse.trim();
  if (Array.isArray(imageUrls) && imageUrls[0]) return imageUrls[0];
  return null;
}
