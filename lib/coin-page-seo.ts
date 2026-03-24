import type { CoinDetailData } from "../components/CoinDetail";
import { cleanCoinTitle } from "./cleanTitle";
import { absoluteAssetUrl, absolutePageUrl } from "./site-url";

const TITLE_MAX = 58;
const DESC_MAX = 158;

export function coinSeoTitle(coin: CoinDetailData): string {
  const raw = cleanCoinTitle(coin.title);
  const t = raw.length > TITLE_MAX ? `${raw.slice(0, TITLE_MAX - 1)}…` : raw;
  return `${t} — Omonete`;
}

export function coinSeoDescription(coin: CoinDetailData): string {
  const chunks: string[] = [];
  const title = cleanCoinTitle(coin.title);
  if (title) chunks.push(title + ".");
  if (coin.year) chunks.push(`${coin.year} год.`);
  if (coin.mintName?.trim()) chunks.push(`${coin.mintName.trim()}.`);
  if (coin.seriesName?.trim()) chunks.push(`Серия «${coin.seriesName.trim()}».`);
  const fv = coin.faceValue && String(coin.faceValue).trim();
  if (fv && fv !== "—") chunks.push(`Номинал ${fv}.`);
  if (coin.metal?.trim()) chunks.push(`${coin.metal.trim()}.`);
  if (coin.weightOz?.trim()) chunks.push(`${coin.weightOz.trim()}.`);
  chunks.push("Каталог монет Omonete.");
  let out = chunks.join(" ").replace(/\s+/g, " ").trim();
  if (out.length > DESC_MAX) out = `${out.slice(0, DESC_MAX - 1)}…`;
  return out;
}

export function coinCanonicalPath(coinId: string): string {
  return `/coins/${coinId}/`;
}

export function coinOpenGraphImageUrls(coin: CoinDetailData): string[] {
  const urls = new Set<string>();
  const add = (u: string | undefined) => {
    const abs = absoluteAssetUrl(u);
    if (abs) urls.add(abs);
  };
  add(coin.imageUrl);
  (coin.imageUrls ?? []).forEach(add);
  if (urls.size === 0) add("/image/logo.png");
  return [...urls].slice(0, 4);
}

/** JSON-LD: Product + BreadcrumbList в одном @graph. */
export function coinJsonLdGraph(coin: CoinDetailData, coinId: string): Record<string, unknown> {
  const pageUrl = absolutePageUrl(coinCanonicalPath(coinId));
  const name = cleanCoinTitle(coin.title) || `Монета ${coinId}`;
  const description = coinSeoDescription(coin);
  const images = coinOpenGraphImageUrls(coin);

  const product: Record<string, unknown> = {
    "@type": "Product",
    name,
    description,
    image: images,
    brand: {
      "@type": "Brand",
      name: coin.mintName?.trim() || "Omonete",
    },
    category: "Collectible coins",
    url: pageUrl,
  };

  const breadcrumbs = {
    "@type": "BreadcrumbList",
    itemListElement: [
      {
        "@type": "ListItem",
        position: 1,
        name: "Главная",
        item: absolutePageUrl("/"),
      },
      {
        "@type": "ListItem",
        position: 2,
        name: "Каталог",
        item: absolutePageUrl("/catalog"),
      },
      {
        "@type": "ListItem",
        position: 3,
        name,
        item: pageUrl,
      },
    ],
  };

  return {
    "@context": "https://schema.org",
    "@graph": [product, breadcrumbs],
  };
}
