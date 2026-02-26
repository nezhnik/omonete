"use client";

import { useState, useEffect, useMemo } from "react";
import Link from "next/link";
import { Header } from "../../components/Header";
import { Button } from "../../components/Button";
import { IconSearch, IconDownload, IconShare, IconChevronDown, IconMinus, IconPlus, IconArrowUp } from "@tabler/icons-react";
import { cleanCoinTitle } from "../../lib/cleanTitle";
import { formatNumber } from "../../lib/formatNumber";
import { useAuth } from "../../components/AuthProvider";

/** Первая — прямоугольная «Зайка» для проверки отображения; остальные — как в блоке «Российские» на главной */
const RUSSIAN_FEATURED_IDS = ["3799", "2838", "3699", "2518", "3395", "3293", "3292", "3294", "2840", "3940", "3119"];

/** Двор «ММД + СПМД» — показываем логотип Гознака */
const MINT_TWO_RUSSIA = "Московский и Санкт-Петербургский монетные дворы";
const GOZNAK_LOGO = "/image/Mints/goznak.webp";

const PORTFOLIO_SKELETON_ROWS = 8;

/** Скелетон таблицы портфолио: те же ширина и раскладка, что и у готовой таблицы (table-fixed + одинаковые классы колонок) */
function PortfolioTableSkeleton() {
  return (
    <div className="rounded-2xl border border-[#E4E4EA] overflow-hidden skeleton-pulse-opacity" aria-hidden>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[1200px] border-collapse table-fixed">
          <colgroup>
            <col className="w-8" />
            <col className="w-[360px]" />
            <col className="w-[264px]" />
            <col className="w-[196px]" />
            <col className="w-[104px]" />
            <col className="w-[168px]" />
            <col className="w-[184px]" />
            <col className="w-[272px]" />
            <col className="w-10" />
          </colgroup>
          <thead>
            <tr className="border-b border-[#E4E4EA]">
              <th className="h-12 pl-[0.75rem] pr-0 py-0 align-middle">
                <div className="w-8 h-8 flex items-center justify-center">
                  <span className="w-5 h-5 rounded-full bg-[#E4E4EA]" />
                </div>
              </th>
              <th className="px-2 py-3 text-left text-[18px] font-semibold text-black">Название / серия</th>
              <th className="px-2 py-3 text-left text-[18px] font-semibold text-black">Монетный двор / страна</th>
              <th className="px-2 py-3 text-left text-[18px] font-semibold text-black">Номинал / металл</th>
              <th className="px-2 py-3 text-right text-[18px] font-semibold text-black">Тираж</th>
              <th className="px-2 py-3 text-right text-[18px] font-semibold text-black">В коллекции</th>
              <th className="px-2 py-3 text-right text-[18px] font-semibold text-black">Цена покупки, ₽</th>
              <th className="px-2 py-3 text-right text-[18px] font-semibold text-black">Цена монеты / металла, ₽</th>
              <th className="pr-[0.75rem]" />
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: PORTFOLIO_SKELETON_ROWS }).map((_, i) => (
              <tr key={i} className="border-b border-[#E4E4EA] last:border-b-0">
                <td className="pl-[0.75rem] py-2 align-middle">
                  <div className="w-8 h-8 flex items-center justify-center">
                    <span className="w-5 h-5 rounded-full bg-[#E4E4EA]" />
                  </div>
                </td>
                <td className="px-2 py-3 align-middle">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-[80px] h-[80px] shrink-0 rounded-full bg-[#E4E4EA]" />
                    <div className="flex flex-col gap-1 min-w-0 flex-1 overflow-hidden">
                      <div className="h-4 w-full max-w-[140px] rounded-[300px] bg-[#E4E4EA]" />
                      <div className="h-3 w-full max-w-[100px] rounded-[300px] bg-[#E4E4EA]" />
                    </div>
                  </div>
                </td>
                <td className="px-2 py-3 align-middle">
                  <div className="flex items-start gap-2">
                    <div className="w-10 h-10 rounded-[6.86px] bg-[#E4E4EA] shrink-0" />
                    <div className="flex flex-col gap-0.5 min-w-0 flex-1 overflow-hidden">
                      <div className="h-4 w-full max-w-[120px] rounded-[300px] bg-[#E4E4EA]" />
                      <div className="h-3 w-full max-w-[60px] rounded-[300px] bg-[#E4E4EA]" />
                    </div>
                  </div>
                </td>
                <td className="px-2 py-3 align-middle">
                  <div className="flex flex-col gap-1">
                    <div className="h-4 w-16 rounded-[300px] bg-[#E4E4EA]" />
                    <div className="h-6 w-20 rounded-full bg-[#E4E4EA]" />
                  </div>
                </td>
                <td className="px-2 py-3 text-right align-middle">
                  <div className="h-4 w-12 rounded-[300px] bg-[#E4E4EA] ml-auto" />
                </td>
                <td className="px-2 py-3 text-right align-middle">
                  <div className="flex items-center justify-end gap-1">
                    <div className="w-8 h-8 rounded bg-[#E4E4EA]" />
                    <div className="w-12 h-8 rounded bg-[#E4E4EA]" />
                    <div className="w-8 h-8 rounded bg-[#E4E4EA]" />
                  </div>
                </td>
                <td className="px-2 py-3 text-right align-middle">
                  <div className="h-4 w-14 rounded-[300px] bg-[#E4E4EA] ml-auto" />
                </td>
                <td className="px-2 py-3 align-middle">
                  <div className="flex items-center justify-end gap-4">
                    <div className="flex flex-col gap-1 items-end">
                      <div className="h-4 w-16 rounded-[300px] bg-[#E4E4EA]" />
                      <div className="h-3 w-12 rounded-[300px] bg-[#E4E4EA]" />
                    </div>
                    <div className="w-[5rem] h-6 bg-[#E4E4EA] rounded shrink-0" />
                  </div>
                </td>
                <td className="px-2 pr-[0.75rem] py-2 align-middle">
                  <div className="w-6 h-6 rounded bg-[#E4E4EA]" />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

type PortfolioRow = {
  id: string;
  imageUrl: string;
  title: string;
  series: string;
  mintName: string;
  mintCountry: string;
  mintLogoUrl: string;
  faceValue: string;
  metal: string;
  metalColor: string;
  metalLabel: string;
  mintage: string;
  buyPrice: string;
  coinPrice: string;
  metalPrice: string;
  /** Вес чистого металла, гр. (для расчёта стоимости по цене ЦБ РФ) */
  weightG?: string;
  rectangular?: boolean;
};

/** Данные монеты из /data/coins/[id].json (поле coin) */
type ApiCoin = {
  id: string;
  title: string;
  seriesName?: string;
  imageUrl: string;
  mintName?: string;
  mintCountry?: string;
  mintLogoUrl?: string;
  faceValue?: string;
  metal?: string;
  metalCode?: string;
  metalColor?: string;
  mintage?: number;
  mintageDisplay?: string;
  weightG?: string;
  rectangular?: boolean;
};

/** Нормализует строку для поиска: нижний регистр, лишние пробелы убраны */
function normalizeSearchPortfolio(s: string): string {
  return s.toLowerCase().replace(/\s+/g, " ").trim();
}

function portfolioRowMatchesSearch(row: PortfolioRow, queryNorm: string): boolean {
  if (!queryNorm) return true;
  const words = queryNorm.split(/\s+/).filter(Boolean);
  const fields = [row.title, row.series, row.mintName, row.faceValue, row.metalLabel];
  const normFields = fields.map((f) => normalizeSearchPortfolio(f ?? ""));
  return words.every((w) => normFields.some((f) => f.includes(w)));
}

function coinToPortfolioRow(coin: ApiCoin, index: number): PortfolioRow {
  const metalLabel = [coin.metal, coin.weightG && `${coin.weightG} гр.`].filter(Boolean).join(" · ") || "—";
  const mintageStr =
    coin.mintageDisplay ?? (coin.mintage != null ? formatNumber(coin.mintage) : "—");
  const isGold = coin.metalCode === "Au";
  const isSilver = coin.metalCode === "Ag";
  const base = index % 3;
  let buyPrice: number;
  let coinPrice: number;
  let metalPrice: number;
  if (isGold) {
    buyPrice = 42000 + base * 2000 + index * 500;
    coinPrice = 50000 + base * 1500 + index * 400;
    metalPrice = 46000 + base * 1500 + index * 300;
  } else if (isSilver) {
    buyPrice = 4800 + base * 400 + index * 100;
    coinPrice = 7200 + base * 500 + index * 150;
    metalPrice = 6500 + base * 300 + index * 80;
  } else {
    buyPrice = 800 + index * 100;
    coinPrice = 1200 + index * 150;
    metalPrice = 900 + index * 80;
  }
  return {
    id: coin.id,
    imageUrl: coin.imageUrl || "/image/coin-placeholder.svg",
    title: coin.title ?? "—",
    series: coin.seriesName ?? "—",
    mintName: coin.mintName ?? "—",
    mintCountry: coin.mintCountry ?? "Россия",
    mintLogoUrl: coin.mintLogoUrl ?? "/image/coin-placeholder.svg",
    faceValue: coin.faceValue ?? "—",
    metal: coin.metalCode ?? "—",
    metalColor: coin.metalColor ?? "#C0C0C0",
    metalLabel,
    mintage: mintageStr,
    buyPrice: formatNumber(buyPrice),
    coinPrice: `~ ${formatNumber(coinPrice)}`,
    metalPrice: formatNumber(metalPrice),
    weightG: coin.weightG,
    rectangular: coin.rectangular ?? false,
  };
}

const CHART_GREEN = "#16A34A";
const CHART_RED = "#DC2626";

/** Минималистичный график цены металла: 80×24. Реальные данные за месяц — зелёный при росте, красный при падении; без данных — статичная кривая (серый). */
function MetalPriceChart({ metal, data }: { metal: string; data: { label: string; value: number }[] | null }) {
  const w = 80;
  const h = 24;
  const pad = 2;
  const innerW = w - pad * 2;
  const innerH = h - pad * 2;

  let pathD: string;
  let stroke: string;

  if (data && data.length > 0) {
    const first = data[0].value;
    const last = data[data.length - 1].value;
    stroke = last >= first ? CHART_GREEN : CHART_RED;
    const min = Math.min(...data.map((d) => d.value));
    const max = Math.max(...data.map((d) => d.value));
    const range = max - min || 1;
    const points = data.map((d, i) => {
      const x = pad + (i / (data.length - 1 || 1)) * innerW;
      const y = pad + innerH - ((d.value - min) / range) * innerH;
      return `${x},${y}`;
    });
    pathD = `M ${points.join(" L ")}`;
  } else {
    stroke = "#9CA3AF";
    const isGold = metal === "Au";
    pathD = isGold ? "M 0 5 L 15 12 L 28 6 L 42 16 L 55 10 L 68 18 L 80 22" : "M 0 20 L 12 14 L 22 18 L 32 8 L 45 14 L 55 6 L 68 12 L 80 4";
  }

  return (
    <svg width="5rem" height="1.5rem" viewBox={`0 0 ${w} ${h}`} fill="none" className="shrink-0" aria-hidden>
      <path d={pathD} stroke={stroke} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** Ответ API графиков металлов за месяц */
type MetalPrices1m = {
  ok: boolean;
  XAU?: { label: string; value: number }[];
  XAG?: { label: string; value: number }[];
  XPT?: { label: string; value: number }[];
  XPD?: { label: string; value: number }[];
};

function getMetalChartData(api: MetalPrices1m | null, metal: string): { label: string; value: number }[] | null {
  if (!api?.ok || !metal) return null;
  if (metal === "Au") return api.XAU ?? null;
  if (metal === "Ag") return api.XAG ?? null;
  if (metal === "Pt") return api.XPT ?? null;
  if (metal === "Pd") return api.XPD ?? null;
  return null;
}

/** Текущая цена металла за грамм (последнее значение из API за месяц), руб. */
function getCurrentPricePerGram(api: MetalPrices1m | null, metal: string): number | null {
  const data = getMetalChartData(api, metal);
  if (!data?.length) return null;
  return data[data.length - 1].value;
}

/** Парсит вес из строки "7,742" или "31,1" в число (гр.). */
function parseWeightG(weightG: string | undefined): number | null {
  if (!weightG?.trim()) return null;
  const num = parseFloat(weightG.trim().replace(",", "."));
  return Number.isFinite(num) && num > 0 ? num : null;
}

export default function PortfolioPage() {
  const { isAuthorized, collectionIds, loading: authLoading } = useAuth();
  const [portfolioRows, setPortfolioRows] = useState<PortfolioRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [collectionCounts, setCollectionCounts] = useState<number[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [showScrollTop, setShowScrollTop] = useState(false);
  const [metalPrices1m, setMetalPrices1m] = useState<MetalPrices1m | null>(null);

  useEffect(() => {
    const onScroll = () => setShowScrollTop(typeof window !== "undefined" && window.scrollY > 500);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    fetch("/api/metal-prices?period=1m")
      .then((r) => r.json() as Promise<MetalPrices1m>)
      .then((res) => res?.ok && setMetalPrices1m(res))
      .catch(() => {});
  }, []);

  const searchNorm = useMemo(() => normalizeSearchPortfolio(searchQuery), [searchQuery]);
  const filteredRows = useMemo(
    () => (searchNorm ? portfolioRows.filter((r) => portfolioRowMatchesSearch(r, searchNorm)) : portfolioRows),
    [portfolioRows, searchNorm]
  );

  useEffect(() => {
    if (authLoading) return;

    // Авторизованный пользователь: если коллекция пустая — показываем эмпти-стейт, без демо-данных
    if (isAuthorized) {
      if (collectionIds.size === 0) {
        setPortfolioRows([]);
        setCollectionCounts([]);
        setLoading(false);
        return;
      }
      const ids = Array.from(collectionIds);
      setLoading(true);
      Promise.allSettled(
        ids.map((id) =>
          fetch(`/data/coins/${id}.json`).then((r) => (r.ok ? r.json() : Promise.reject(new Error(id))))
        )
      ).then((results) => {
        const rows: PortfolioRow[] = [];
        results.forEach((res) => {
          if (res.status === "fulfilled" && res.value?.coin) {
            rows.push(coinToPortfolioRow(res.value.coin as ApiCoin, rows.length));
          }
        });
        setPortfolioRows(rows);
        setCollectionCounts(rows.map((_, i) => (i % 2 === 0 ? 1 : 2)));
      }).finally(() => setLoading(false));
      return;
    }

    // Гость: демо-портфолио
    const ids = RUSSIAN_FEATURED_IDS;
    setLoading(true);
    Promise.allSettled(
      ids.map((id) =>
        fetch(`/data/coins/${id}.json`).then((r) => (r.ok ? r.json() : Promise.reject(new Error(id))))
      )
    ).then((results) => {
      const rows: PortfolioRow[] = [];
      results.forEach((res) => {
        if (res.status === "fulfilled" && res.value?.coin) {
          rows.push(coinToPortfolioRow(res.value.coin as ApiCoin, rows.length));
        }
      });
      setPortfolioRows(rows);
      setCollectionCounts(rows.map((_, i) => (i % 2 === 0 ? 1 : 2)));
    }).finally(() => setLoading(false));
  }, [isAuthorized, collectionIds, authLoading]);

  const handleMinus = (index: number) => {
    setCollectionCounts((prev) => {
      const next = [...prev];
      if (next[index] > 1) next[index] -= 1;
      return next;
    });
  };

  const handlePlus = (index: number) => {
    setCollectionCounts((prev) => {
      const next = [...prev];
      next[index] += 1;
      return next;
    });
  };

  return (
    <div className="min-h-screen bg-white">
      <Header activePath="/portfolio" />

      <main className="w-full px-4 sm:px-6 lg:px-20 pb-24">
        {/* Хлебные крошки */}
        <nav className="flex items-center gap-2 pt-6 text-[16px] font-medium text-[#666666]" aria-label="Хлебные крошки">
            <Link href="/" className="hover:text-black">
              Главная
            </Link>
            <span>/</span>
            <span className="text-black">Портфолио</span>
        </nav>

        <div className="mt-8 flex flex-col gap-8 w-full">
          <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-6">
            <div className="min-w-0">
              <h1 className="text-black text-[28px] sm:text-[40px] font-semibold leading-tight">
                Портфолио
              </h1>
              <p className="text-[#666666] text-[16px] leading-[1.5] max-w-[640px] lg:max-w-[720px] mt-2">
                {authLoading
                  ? "Ваши сохранённые монеты. Добавляйте монеты из каталога."
                  : isAuthorized
                    ? "Ваши сохранённые монеты. Добавляйте монеты из каталога."
                    : "Демо-режим: пример коллекции. Войдите, чтобы вести свою коллекцию и добавлять монеты из каталога."}
              </p>
            </div>
            <Button href="/catalog" variant="secondary" className="shrink-0 w-fit">
              Добавить монеты из каталога
            </Button>
          </div>

          {/* Тулбар: всегда виден; при загрузке счётчик — скелетон */}
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <span className="text-[#666666] text-[16px] font-normal">
              {(authLoading || loading)
                ? "Загрузка…"
                : searchNorm
                  ? `Показано ${formatNumber(filteredRows.length)} из ${formatNumber(portfolioRows.length)}`
                  : `Всего ${formatNumber(portfolioRows.length)} ${portfolioRows.length % 100 >= 11 && portfolioRows.length % 100 <= 14 ? "монет" : portfolioRows.length % 10 === 1 ? "монета" : portfolioRows.length % 10 >= 2 && portfolioRows.length % 10 <= 4 ? "монеты" : "монет"}`}
            </span>
            <div className="flex items-center gap-5">
              <label
                htmlFor="portfolio-search-input"
                className="flex items-center gap-2 px-4 py-2 bg-[#F1F1F2] rounded-[32px] border-2 border-transparent transition-colors cursor-pointer hover:bg-[#E4E4EA] focus-within:bg-white focus-within:border-[#11111B] focus-within:hover:bg-white min-w-[200px]"
              >
                <IconSearch size={24} stroke={2} className="shrink-0 pointer-events-none text-[#666666]" />
                <input
                  id="portfolio-search-input"
                  type="search"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Поиск"
                  className="flex-1 min-w-0 bg-transparent text-[16px] leading-[18px] text-[#11111B] placeholder:text-[#666666] outline-none cursor-text"
                  aria-label="Поиск монет в портфолио"
                />
              </label>
              <button type="button" className="flex items-center gap-2 text-[16px] font-medium text-black hover:opacity-80">
                <IconDownload size={24} stroke={2} />
                Скачать Excel
              </button>
              <button type="button" className="flex items-center gap-2 text-[16px] font-medium text-black hover:opacity-80">
                <IconShare size={24} stroke={2} />
                Поделиться
              </button>
            </div>
          </div>

          {/* Только строки таблицы — скелетон при загрузке; контент ниже */}
          {(authLoading || loading) && (
            <PortfolioTableSkeleton />
          )}
          {!authLoading && !loading && isAuthorized && collectionIds.size === 0 && (
            <div className="py-12 flex flex-col items-center justify-center gap-6 text-center">
              <div className="w-24 h-24 rounded-full bg-[#E4E4EA] flex items-center justify-center" aria-hidden />
              <p className="text-[#666666] text-[16px] leading-[1.5] max-w-[360px]">
                У вас пока нет монет в портфолио. Откройте каталог и добавьте монеты — они появятся здесь.
              </p>
              <Button href="/catalog" variant="secondary" className="w-fit">
                Перейти в каталог
              </Button>
            </div>
          )}
          {!authLoading && !loading && (!isAuthorized || collectionIds.size > 0) && portfolioRows.length === 0 && (
            <p className="text-[#666666] text-[16px] py-8">Не удалось загрузить данные.</p>
          )}
          {!authLoading && !loading && portfolioRows.length > 0 && (
          <div className="rounded-2xl border border-[#E4E4EA] overflow-hidden">
            {searchNorm && filteredRows.length === 0 ? (
              <p className="text-[#666666] text-[16px] py-8 px-4">По запросу ничего не найдено.</p>
            ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[1200px] border-collapse table-fixed">
                <colgroup>
                  <col className="w-8" />
                  <col className="w-[360px]" />
                  <col className="w-[264px]" />
                  <col className="w-[196px]" />
                  <col className="w-[104px]" />
                  <col className="w-[168px]" />
                  <col className="w-[184px]" />
                  <col className="w-[272px]" />
                  <col className="w-10" />
                </colgroup>
                <thead>
                  <tr className="border-b border-[#E4E4EA]">
                    <th className="h-12 pl-[0.75rem] pr-0 py-0 align-middle">
                      <div className="w-8 h-8 flex items-center justify-center">
                        <span className="w-5 h-5 rounded-full border-2 border-[#11111B]" />
                      </div>
                    </th>
                    <th className="px-2 py-3 text-left text-[18px] font-semibold text-black">
                      Название / серия
                    </th>
                    <th className="px-2 py-3 text-left text-[18px] font-semibold text-black">
                      Монетный двор / страна
                    </th>
                    <th className="px-2 py-3 text-left text-[18px] font-semibold text-black">
                      Номинал / металл
                    </th>
                    <th className="px-2 py-3 text-right text-[18px] font-semibold text-black">
                      Тираж
                    </th>
                    <th className="px-2 py-3 text-right text-[18px] font-semibold text-black">
                      В коллекции
                    </th>
                    <th className="px-2 py-3 text-right text-[18px] font-semibold text-black">
                      Цена покупки, ₽
                    </th>
                    <th className="px-2 py-3 text-right text-[18px] font-semibold text-black">
                      Цена монеты / металла, ₽
                    </th>
                    <th className="pr-[0.75rem]" />
                  </tr>
                </thead>
                <tbody>
                  {filteredRows.map((row) => {
                    const origIndex = portfolioRows.findIndex((r) => r.id === row.id);
                    const i = origIndex >= 0 ? origIndex : 0;
                    return (
                    <tr key={row.id} className="group border-b border-[#E4E4EA] last:border-b-0">
                      <td className="pl-[0.75rem] py-2 align-middle transition-colors duration-150 group-hover:bg-[#F1F1F2]">
                        <div className="w-8 h-8 flex items-center justify-center">
                          <span className="w-5 h-5 rounded-full border-2 border-[#11111B]" />
                        </div>
                      </td>
                      <td className="px-2 py-3 align-middle transition-colors duration-150 group-hover:bg-[#F1F1F2]">
                        <div className="flex items-center gap-3 min-w-0">
                          <div
                            className={`w-[80px] h-[80px] shrink-0 overflow-hidden flex items-center justify-center ${row.rectangular ? "rounded-2xl" : "rounded-full"}`}
                          >
                            <img
                              src={row.imageUrl}
                              alt=""
                              className="w-full h-full object-contain"
                            />
                          </div>
                          <div className="flex flex-col gap-1 min-w-0">
                            <span className="text-black text-[16px] font-medium">{cleanCoinTitle(row.title)}</span>
                            {row.series && row.series !== "—" && (
                              <span className="text-[#666666] text-[14px]">{row.series}</span>
                            )}
                          </div>
                        </div>
                      </td>
                      <td className="px-2 py-3 align-middle transition-colors duration-150 group-hover:bg-[#F1F1F2]">
                        <div className="flex items-start gap-2">
                          <img
                            src={row.mintName === MINT_TWO_RUSSIA ? GOZNAK_LOGO : row.mintLogoUrl}
                            alt=""
                            className="w-10 h-10 rounded-[6.86px] bg-white shrink-0"
                          />
                          <div className="flex flex-col gap-0.5 min-w-0">
                            <span className="text-black text-[16px] font-medium">{row.mintName}</span>
                            <span className="text-[#666666] text-[14px]">{row.mintCountry}</span>
                          </div>
                        </div>
                      </td>
                      <td className="px-2 py-3 align-middle transition-colors duration-150 group-hover:bg-[#F1F1F2]">
                        <div className="flex flex-col gap-1">
                          <span className="text-black text-[16px] font-medium">{row.faceValue}</span>
                          <div className="flex items-center gap-1 min-h-6">
                            <span
                              className="w-6 h-6 shrink-0 rounded-full flex items-center justify-center text-[12px] font-medium text-[#11111B]"
                              style={{ background: row.metalColor }}
                            >
                              {row.metal}
                            </span>
                            <span className="text-[#666666] text-[14px] min-w-0">{row.metalLabel}</span>
                          </div>
                        </div>
                      </td>
                      <td className="px-2 py-3 text-right text-[16px] font-medium text-black transition-colors duration-150 group-hover:bg-[#F1F1F2]">
                        {row.mintage}
                      </td>
                      <td className="px-2 py-3 text-right transition-colors duration-150 group-hover:bg-[#F1F1F2]">
                        <div className="flex items-center justify-end gap-1">
                          <button
                            type="button"
                            onClick={() => handleMinus(i)}
                            disabled={collectionCounts[i] <= 1}
                            className="w-8 h-8 rounded flex items-center justify-center border border-[#E4E4EA] text-[#11111B] transition-colors duration-150 hover:bg-[#11111B] hover:text-white hover:border-[#11111B] disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent disabled:hover:text-[#11111B] disabled:hover:border-[#E4E4EA]"
                            aria-label="Уменьшить"
                          >
                            <IconMinus size={16} stroke={2} />
                          </button>
                          <input
                            type="text"
                            inputMode="numeric"
                            value={collectionCounts[i]}
                            onChange={(e) => {
                              const v = e.target.value.replace(/\D/g, "");
                              if (v === "") {
                                setCollectionCounts((prev) => { const next = [...prev]; next[i] = 0; return next; });
                                return;
                              }
                              const n = parseInt(v, 10);
                              if (!Number.isNaN(n)) setCollectionCounts((prev) => { const next = [...prev]; next[i] = n; return next; });
                            }}
                            onBlur={() => {
                              setCollectionCounts((prev) => {
                                const next = [...prev];
                                if (next[i] < 1) next[i] = 1;
                                return next;
                              });
                            }}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                            }}
                            className="w-12 text-center text-[16px] font-medium text-black border border-transparent rounded focus:outline-none focus:border-[#E4E4EA] focus:bg-[#F1F1F2] py-1"
                            aria-label="Количество в коллекции"
                          />
                          <button
                            type="button"
                            onClick={() => handlePlus(i)}
                            className="w-8 h-8 rounded flex items-center justify-center border border-[#E4E4EA] text-[#11111B] transition-colors duration-150 hover:bg-[#11111B] hover:text-white hover:border-[#11111B]"
                            aria-label="Увеличить"
                          >
                            <IconPlus size={16} stroke={2} />
                          </button>
                        </div>
                      </td>
                      <td className="px-2 py-3 text-right text-[16px] font-medium text-black transition-colors duration-150 group-hover:bg-[#F1F1F2]">
                        {row.buyPrice}
                      </td>
                      <td className="px-2 py-3 transition-colors duration-150 group-hover:bg-[#F1F1F2]">
                        <div className="flex items-center justify-end gap-4">
                          <div className="flex flex-col items-end gap-0.5">
                            <span className="text-[16px] font-medium text-black">{row.coinPrice}</span>
                            <span className="text-[14px] text-[#666666]">
                              {(() => {
                                const pricePerGram = getCurrentPricePerGram(metalPrices1m, row.metal);
                                const weight = parseWeightG(row.weightG);
                                if (pricePerGram != null && weight != null) {
                                  return formatNumber(Math.round(pricePerGram * weight));
                                }
                                return "—";
                              })()}
                            </span>
                          </div>
                          <MetalPriceChart metal={row.metal} data={getMetalChartData(metalPrices1m, row.metal)} />
                        </div>
                      </td>
                      <td className="px-2 pr-[0.75rem] py-2 align-middle transition-colors duration-150 group-hover:bg-[#F1F1F2]">
                        <Link href={`/coins/${row.id}/?from=portfolio`} className="w-6 h-6 flex items-center justify-center text-[#11111B] hover:opacity-70" aria-label="Перейти к монете">
                          <IconChevronDown size={20} stroke={2} className="rotate-[-90deg]" />
                        </Link>
                      </td>
                    </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            )}
          </div>
          )}
        </div>
      </main>

      {showScrollTop && (
        <button
          type="button"
          onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
          className="fixed right-6 z-40 w-12 h-12 rounded-full bg-[#11111B] text-white hover:bg-[#27273a] flex items-center justify-center cursor-pointer transition-colors duration-150 bottom-4 sm:bottom-6"
          aria-label="Наверх"
        >
          <IconArrowUp size={24} stroke={2} className="shrink-0 block" />
        </button>
      )}
    </div>
  );
}
