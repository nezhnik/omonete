/** Канонический хост сайта (без завершающего слэша). Совпадает с app/sitemap.ts и app/robots.ts. */
export function getSiteUrl(): string {
  return (
    process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/+$/, "") ||
    process.env.SITE_URL?.replace(/\/+$/, "") ||
    "https://omonete.ru"
  );
}

/** Абсолютный URL страницы с учётом trailingSlash в next.config. */
export function absolutePageUrl(path: string): string {
  const base = getSiteUrl();
  if (path === "/" || path === "") return `${base}/`;
  const p = path.startsWith("/") ? path : `/${path}`;
  const withSlash = p.endsWith("/") ? p : `${p}/`;
  return `${base}${withSlash}`;
}

/** Абсолютный URL для картинки или любого пути (без принудительного слэша в конце пути к файлу). */
export function absoluteAssetUrl(pathOrUrl: string | undefined | null): string {
  const base = getSiteUrl();
  if (!pathOrUrl || !String(pathOrUrl).trim()) return `${base}/image/logo.png`;
  const u = String(pathOrUrl).trim();
  if (/^https?:\/\//i.test(u)) return u;
  return `${base}${u.startsWith("/") ? u : `/${u}`}`;
}
