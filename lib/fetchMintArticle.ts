import { headers } from "next/headers";
import { getMintArticle } from "./mint-articles";
import type { MintArticleData } from "./mint-articles";

/** Загрузка статьи двора: API (БД) или из кода (fallback). Только для сервера. */
export async function fetchMintArticle(slug: string): Promise<MintArticleData | null> {
  let base = "http://localhost:3000";
  try {
    const h = await headers();
    const host = h.get("host") ?? "localhost:3000";
    base = host.includes("localhost") ? `http://${host}` : `https://${host}`;
  } catch {
    // ignore
  }
  try {
    const res = await fetch(`${base}/api/mints/${encodeURIComponent(slug.toLowerCase())}`, {
      cache: "no-store",
    });
    if (res.ok) {
      const data = (await res.json()) as MintArticleData;
      if (data?.slug) return data;
    }
  } catch {
    // ignore
  }
  return getMintArticle(slug);
}
