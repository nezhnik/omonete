/** Ключ для сравнения src после onError (относительный путь или pathname URL). */
export function galleryImageSrcKey(raw: string): string {
  if (!raw) return "";
  const t = raw.trim();
  if (t.startsWith("/")) return t;
  try {
    return new URL(t).pathname;
  } catch {
    return t;
  }
}
