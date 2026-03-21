import { getMintArticleLogoPairs } from "./mint-articles";

export type ForeignMintCard = { id: string; name: string; country: string; imageUrl: string };

/**
 * Зарубежные дворы: те же пути логотипов, что на главной и в статьях.
 * Дополняет getMintArticleLogoPairs (там — русские/короткие имена из статей).
 */
export const FOREIGN_MINT_CARD_LIST: ForeignMintCard[] = [
  { id: "us-mint", name: "Монетный двор США", country: "США", imageUrl: "/image/Mints/us-mint.webp" },
  { id: "royal-mint", name: "Королевский монетный двор Великобритании", country: "Великобритания", imageUrl: "/image/Mints/royal-mint.webp" },
  { id: "austrian-mint", name: "Австрийский монетный двор", country: "Австрия", imageUrl: "/image/Mints/austrian-mint.webp" },
  { id: "south-african-mint", name: "Южноафриканский монетный двор", country: "ЮАР", imageUrl: "/image/Mints/south-african-mint.webp" },
  { id: "japan-mint", name: "Монетный двор Японии", country: "Япония", imageUrl: "/image/Mints/japan-mint.webp" },
  { id: "komsco", name: "Корпорация чеканки и печати Кореи", country: "Южная Корея", imageUrl: "/image/Mints/komsco.webp" },
  { id: "monnaie-de-paris", name: "Монетный двор Парижа", country: "Франция", imageUrl: "/image/Mints/monnaie-de-paris.webp" },
  { id: "casa-de-moneda-mexico", name: "Монетный двор Мексики", country: "Мексика", imageUrl: "/image/Mints/casa-de-moneda-mexico.webp" },
  { id: "china-mint", name: "Корпорация печати и чеканки Китая", country: "Китай", imageUrl: "/image/Mints/china-mint.webp" },
  { id: "fnmt-spain", name: "Королевский монетный двор Испании", country: "Испания", imageUrl: "/image/Mints/fnmt-spain.webp" },
  { id: "ipzs-italy", name: "Государственный полиграфический институт и монетный двор Италии", country: "Италия", imageUrl: "/image/Mints/ipzs-italy.webp" },
  { id: "india-government-mint", name: "Монетные дворы Индии", country: "Индия", imageUrl: "/image/Mints/india-mint.webp" },
  { id: "royal-dutch-mint", name: "Королевский монетный двор Нидерландов", country: "Нидерланды", imageUrl: "/image/Mints/royal-dutch-mint.webp" },
  { id: "swissmint", name: "Федеральный монетный двор Швейцарии", country: "Швейцария", imageUrl: "/image/Mints/swissmint.webp" },
  { id: "perth-mint", name: "The Perth Mint", country: "Австралия", imageUrl: "/image/Mints/perth-mint.webp" },
  { id: "royal-australian-mint", name: "Royal Australian Mint", country: "Австралия", imageUrl: "/image/Mints/royal-australian-mint.webp" },
  { id: "germania-mint", name: "Germania Mint", country: "Германия", imageUrl: "/image/Mints/germania-mint.webp" },
  { id: "polska-mint", name: "Mint of Poland", country: "Польша", imageUrl: "/image/Mints/polska-mint.webp" },
  { id: "canadian-mint", name: "Royal Canadian Mint", country: "Канада", imageUrl: "/image/Mints/canadian-mint.webp" },
];

const PLACEHOLDER = "/image/coin-placeholder.png";

/** Собирает Map: точное имя дворов (как в монете / БД) → URL логотипа. */
export function buildMintLogoLookupMap(
  mintsJson: ReadonlyArray<{ name?: string; logo_url?: string | null }>,
): Map<string, string> {
  const m = new Map<string, string>();
  const add = (name: string | undefined | null, url: string | undefined | null) => {
    const n = name != null ? String(name).trim() : "";
    const u = url != null ? String(url).trim() : "";
    if (n && u) m.set(n, u);
  };
  for (const row of mintsJson) add(row.name, row.logo_url);
  for (const { name, logoUrl } of getMintArticleLogoPairs()) add(name, logoUrl);
  for (const x of FOREIGN_MINT_CARD_LIST) add(x.name, x.imageUrl);
  return m;
}

export function resolveMintLogoUrl(
  mintName: string | undefined | null,
  lookup: Map<string, string>,
  fallback?: string | null,
): string {
  const fb = fallback != null && String(fallback).trim() ? String(fallback).trim() : "";
  const key = mintName != null ? String(mintName).trim() : "";
  if (!key) return fb || PLACEHOLDER;
  return lookup.get(key) || fb || PLACEHOLDER;
}
