"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Header } from "../../../components/Header";
import { CoinDetail, type CoinDetailData, type CoinSeriesItem } from "../../../components/CoinDetail";
import { cleanCoinTitle } from "../../../lib/cleanTitle";
import { useAuth } from "../../../components/AuthProvider";

type Props = { id: string; initialData?: { coin: CoinDetailData; sameSeries: CoinSeriesItem[] } | null };

export function CoinPageClient({ id, initialData }: Props) {
  const searchParams = useSearchParams();
  const fromParam = searchParams.get("from");
  const fromPortfolio = fromParam === "portfolio";

  const [coin, setCoin] = useState<CoinDetailData | null>(initialData?.coin ?? null);
  const [sameSeries, setSameSeries] = useState<CoinSeriesItem[]>(initialData?.sameSeries ?? []);
  const [loading, setLoading] = useState(!initialData);
  const [error, setError] = useState(false);
  const [catalogHref, setCatalogHref] = useState("/catalog");
  const { isAuthorized, inCollection, addToCollection, removeFromCollection } = useAuth();
  const handleToggleCollection = useCallback((coinId: string) => {
    if (inCollection(coinId)) removeFromCollection(coinId);
    else addToCollection(coinId);
  }, [inCollection, addToCollection, removeFromCollection]);

  const backHref = fromPortfolio ? "/portfolio" : catalogHref;
  const backLabel = fromPortfolio ? "Назад в портфолио" : "Назад в каталог";
  const breadcrumbLabel = fromPortfolio ? "Портфолио" : "Каталог";

  useEffect(() => {
    if (fromPortfolio) return;
    try {
      const saved = sessionStorage.getItem("catalogReturnUrl");
      if (saved && saved.startsWith("/catalog")) setCatalogHref(saved);
    } catch {
      // ignore
    }
  }, [fromPortfolio]);

  useEffect(() => {
    if (!id || initialData) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(false);
    import("../../../lib/fetchCoins").then(({ fetchCoinById }) =>
      fetchCoinById(id)
        .then((data) => {
          if (data) {
            setCoin(data.coin ?? null);
            setSameSeries((data.sameSeries as unknown[]) ?? []);
          } else setError(true);
        })
        .catch(() => setError(true))
        .finally(() => setLoading(false))
    );
  }, [id, initialData]);

  if (loading) {
    return (
      <div className="min-h-screen bg-white">
        <Header activePath="/catalog" />
        <main className="w-full px-4 sm:px-6 lg:px-20 py-12">
          <p className="text-[#666666]">Загрузка...</p>
        </main>
      </div>
    );
  }

  if (error || !coin) {
    return (
      <div className="min-h-screen bg-white">
        <Header activePath="/catalog" />
        <main className="w-full px-4 sm:px-6 lg:px-20 py-12">
          <p className="text-[#666666]">Монета не найдена.</p>
          <Link href={backHref} className="text-[#0098E8] font-medium pt-4 inline-block">
            {fromPortfolio ? "Вернуться в портфолио" : "Вернуться в каталог"}
          </Link>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-white">
      <Header activePath="/catalog" />

      <main className="w-full pt-6">
        <nav className="hidden lg:flex px-4 sm:px-6 lg:px-20 pb-6 items-center gap-2 min-w-0 text-[16px] font-medium text-[#666666]">
          <Link href={backHref} className="hover:text-black shrink-0">
            {breadcrumbLabel}
          </Link>
          <span className="shrink-0">/</span>
          <span className="text-[#666666] min-w-0 truncate" title={cleanCoinTitle(coin.title)}>
            {cleanCoinTitle(coin.title)}
          </span>
        </nav>

        <CoinDetail
          coin={{ ...coin, inCollection: inCollection(coin.id) }}
          sameSeries={sameSeries}
          backHref={backHref}
          backLabel={backLabel}
          isAuthorized={isAuthorized}
          onToggleCollection={handleToggleCollection}
        />
      </main>
    </div>
  );
}
