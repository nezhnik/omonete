/** Вкладка каталога по стране эмитента (как на странице монеты). */
export function catalogTabForCountry(mintCountry: string | undefined | null): "ru" | "foreign" {
  return /^россия$/i.test(String(mintCountry ?? "").trim()) ? "ru" : "foreign";
}

/** Ссылка на каталог с фильтром по монетному двору (значение mint — как в данных каталога). */
export function catalogHrefForMint(mintName: string | undefined | null, mintCountry: string | undefined | null): string {
  const name = mintName && String(mintName).trim();
  if (!name) return "/catalog/";
  const p = new URLSearchParams();
  p.set("tab", catalogTabForCountry(mintCountry));
  p.append("mint", name);
  return `/catalog/?${p.toString()}`;
}

/** Ссылка на каталог с фильтром по серии. */
export function catalogHrefForSeries(seriesName: string | undefined | null, mintCountry: string | undefined | null): string {
  const s = seriesName && String(seriesName).trim();
  if (!s) return "/catalog/";
  const p = new URLSearchParams();
  p.set("tab", catalogTabForCountry(mintCountry));
  p.append("series", s);
  return `/catalog/?${p.toString()}`;
}
