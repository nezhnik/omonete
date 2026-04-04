/**
 * Загрузка данных монет: сначала API (БД), при ошибке — статические JSON.
 */

import { isGradedCoinTitle } from "./isGradedCoinTitle";

export type CoinsListResponse = { coins: unknown[]; total: number };
export type CoinDetailResponse = { coin: unknown; sameSeries: unknown[] };

function filterGradedOutOfCatalogList<T extends { title?: string; titleEn?: string }>(coins: T[]): T[] {
  return coins.filter((c) => !isGradedCoinTitle(c.title, c.titleEn));
}

async function getBaseUrl(): Promise<string> {
  if (typeof window !== "undefined") {
    return "";
  }
  try {
    const { headers } = await import("next/headers");
    const h = await headers();
    const host = h.get("host") ?? "localhost:3000";
    const protocol = host.includes("localhost") ? "http" : "https";
    return `${protocol}://${host}`;
  } catch {
    return process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  }
}

/** Список монет: сначала /data/coins.json (как у SSG страниц монет и при output: export), затем API. */
export async function fetchCoinsList(): Promise<CoinsListResponse> {
  if (typeof window !== "undefined") {
    try {
      const static_ = await fetch("/data/coins.json");
      if (static_.ok) {
        const data = (await static_.json()) as CoinsListResponse;
        if (data.coins && Array.isArray(data.coins) && data.coins.length > 0) {
          const coins = filterGradedOutOfCatalogList(data.coins as { title?: string; titleEn?: string }[]);
          return { coins, total: coins.length };
        }
      }
    } catch {
      // ignore
    }
    try {
      const api = await fetch("/api/coins");
      if (api.ok) {
        const data = (await api.json()) as CoinsListResponse;
        if (data.coins && Array.isArray(data.coins)) {
          const coins = filterGradedOutOfCatalogList(data.coins as { title?: string; titleEn?: string }[]);
          return { coins, total: coins.length };
        }
      }
    } catch {
      // ignore
    }
    return { coins: [], total: 0 };
  }
  const base = await getBaseUrl();
  try {
    const static_ = await fetch(`${base}/data/coins.json`);
    if (static_.ok) {
      const data = (await static_.json()) as CoinsListResponse;
      if (data.coins && Array.isArray(data.coins) && data.coins.length > 0) {
        const coins = filterGradedOutOfCatalogList(data.coins as { title?: string; titleEn?: string }[]);
        return { coins, total: coins.length };
      }
    }
  } catch {
    // ignore
  }
  try {
    const api = await fetch(`${base}/api/coins`);
    if (api.ok) {
      const data = (await api.json()) as CoinsListResponse;
      if (data.coins && Array.isArray(data.coins)) {
        const coins = filterGradedOutOfCatalogList(data.coins as { title?: string; titleEn?: string }[]);
        return { coins, total: coins.length };
      }
    }
  } catch {
    // ignore
  }
  return { coins: [], total: 0 };
}

/** Одна монета: сначала статический JSON, затем API (согласовано со страницей /coins/[id]). */
export async function fetchCoinById(id: string): Promise<CoinDetailResponse | null> {
  if (typeof window !== "undefined") {
    try {
      const static_ = await fetch(`/data/coins/${id}.json`);
      if (static_.ok) return (await static_.json()) as CoinDetailResponse;
    } catch {
      // ignore
    }
    try {
      const api = await fetch(`/api/coins/${id}`);
      if (api.ok) {
        const data = (await api.json()) as CoinDetailResponse;
        if (data.coin) return data;
      }
    } catch {
      // ignore
    }
    return null;
  }
  const base = await getBaseUrl();
  try {
    const static_ = await fetch(`${base}/data/coins/${id}.json`);
    if (static_.ok) return (await static_.json()) as CoinDetailResponse;
  } catch {
    // ignore
  }
  try {
    const api = await fetch(`${base}/api/coins/${id}`);
    if (api.ok) {
      const data = (await api.json()) as CoinDetailResponse;
      if (data.coin) return data;
    }
  } catch {
    // ignore
  }
  return null;
}
