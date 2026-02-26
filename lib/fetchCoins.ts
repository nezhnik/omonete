/**
 * Загрузка данных монет: сначала API (БД), при ошибке — статические JSON.
 */

export type CoinsListResponse = { coins: unknown[]; total: number };
export type CoinDetailResponse = { coin: unknown; sameSeries: unknown[] };

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

/** Список монет: GET /api/coins или /data/coins.json */
export async function fetchCoinsList(): Promise<CoinsListResponse> {
  if (typeof window !== "undefined") {
    try {
      const api = await fetch("/api/coins");
      if (api.ok) {
        const data = (await api.json()) as CoinsListResponse;
        if (data.coins && Array.isArray(data.coins)) return data;
      }
    } catch {
      // ignore
    }
    const static_ = await fetch("/data/coins.json");
    const data = (await static_.json()) as CoinsListResponse;
    return { coins: data.coins ?? [], total: data.total ?? 0 };
  }
  const base = await getBaseUrl();
  try {
    const api = await fetch(`${base}/api/coins`);
    if (api.ok) {
      const data = (await api.json()) as CoinsListResponse;
      if (data.coins && Array.isArray(data.coins)) return data;
    }
  } catch {
    // ignore
  }
  const static_ = await fetch(`${base}/data/coins.json`);
  const data = (await static_.json()) as CoinsListResponse;
  return { coins: data.coins ?? [], total: data.total ?? 0 };
}

/** Одна монета: GET /api/coins/[id] или /data/coins/[id].json */
export async function fetchCoinById(id: string): Promise<CoinDetailResponse | null> {
  if (typeof window !== "undefined") {
    try {
      const api = await fetch(`/api/coins/${id}`);
      if (api.ok) {
        const data = (await api.json()) as CoinDetailResponse;
        if (data.coin) return data;
      }
    } catch {
      // ignore
    }
    const static_ = await fetch(`/data/coins/${id}.json`);
    if (static_.ok) return (await static_.json()) as CoinDetailResponse;
    return null;
  }
  const base = await getBaseUrl();
  try {
    const api = await fetch(`${base}/api/coins/${id}`);
    if (api.ok) {
      const data = (await api.json()) as CoinDetailResponse;
      if (data.coin) return data;
    }
  } catch {
    // ignore
  }
  try {
    const static_ = await fetch(`${base}/data/coins/${id}.json`);
    if (static_.ok) return (await static_.json()) as CoinDetailResponse;
  } catch {
    // ignore
  }
  return null;
}
