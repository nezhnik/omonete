"use client";

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import Lottie from "lottie-react";
import { Header } from "../../components/Header";
import { Button } from "../../components/Button";
import { CoinCard, CoinCardSkeleton } from "../../components/CoinCard";
import { CatalogFilters } from "../../components/CatalogFilters";
import { IconAdjustmentsHorizontal, IconArrowUp, IconArrowsSort, IconX } from "@tabler/icons-react";
import { formatNumber } from "../../lib/formatNumber";
import { nbspAfterPrepositions } from "../../lib/nbspPrepositions";
import { useAuth } from "../../components/AuthProvider";

type CatalogFilter = "all" | "ru" | "foreign";

const VALID_METALS = ["Au", "Pt", "Pd", "Ag", "Cu"];
const VALID_WEIGHTS = [
  "5 кг · 5000 грамм", "3 кг · 3000 грамм", "1 кг · 1000 грамм", "10 унций · 311 г", "5 унций · 155,5 г",
  "3 унции · 93,3 г", "2 унции · 62,2 г", "1 унция · 31,1 грамм", "1/2 унции · 15,55 грамм",
  "1/4 унции · 7,78 грамм", "1/8 унции · 3,89 грамм", "1/10 унции · 3,11 грамм", "1/25 унции · 1,24 грамм",
  "1/100 унции · 0,31 грамм", "1/200 унции · 0,156 грамм", "1/1000 унции · 0,031 грамм",
];
const VALID_COUNTRIES = ["Австралия", "Соединённые Штаты Америки (США)", "Россия", "Германия"];

type CatalogCoin = {
  id: string;
  title: string;
  country: string;
  year: number;
  faceValue?: string;
  imageUrl: string;
  imageUrls?: string[];
  seriesName?: string;
  metalCode?: string;
  metalCodes?: string[];
  metalLabel?: string;
  mintName?: string;
  mintShort?: string;
  weightLabel?: string;
  /** Грамы для сортировки (первое число из weight_g). */
  weightG?: number;
  rectangular?: boolean;
};

export type CatalogSort = "new" | "old" | "weight_desc" | "weight_asc";
const SORT_OPTIONS: { value: CatalogSort; label: string }[] = [
  { value: "new", label: "Сначала новые" },
  { value: "old", label: "Сначала старые" },
  { value: "weight_desc", label: "Больше вес" },
  { value: "weight_asc", label: "Меньше вес" },
];

const PAGE_SIZE = 30;

const FILTERS_TRANSITION_MS = 300;

/** Склонение «монета»: 1 монета, 2–4 монеты, 0/5–20/25–30… монет */
function coinWord(n: number): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 19) return "монет";
  if (mod10 === 1) return "монета";
  if (mod10 >= 2 && mod10 <= 4) return "монеты";
  return "монет";
}
const SKELETON_DURATION_MS = 1000;
const SKELETON_COUNT_DESKTOP = 15;
const SKELETON_COUNT_TABLET = 9;
const SKELETON_COUNT_MOBILE = 6;

const VALID_SORT: CatalogSort[] = ["new", "old", "weight_desc", "weight_asc"];
function parseCatalogState(searchParams: URLSearchParams) {
  const tab = searchParams.get("tab");
  const filter: CatalogFilter = tab === "ru" || tab === "foreign" ? tab : "all";
  const filtersOpen = searchParams.get("open") === "1";
  const sortParam = searchParams.get("sort");
  const sort: CatalogSort = sortParam && VALID_SORT.includes(sortParam as CatalogSort) ? (sortParam as CatalogSort) : "new";
  const selectedMetals = searchParams.getAll("metal").filter((m) => VALID_METALS.includes(m));
  const selectedWeights = searchParams.getAll("weight").filter((w) => VALID_WEIGHTS.includes(w));
  const selectedCountries = searchParams.getAll("country").filter((c) => VALID_COUNTRIES.includes(c));
  const selectedSeries = searchParams.getAll("series");
  const selectedMints = searchParams.getAll("mint");
  const searchQuery = (searchParams.get("q") ?? "").trim();
  return { filter, filtersOpen, sort, selectedMetals, selectedWeights, selectedCountries, selectedSeries, selectedMints, searchQuery };
}

/** Нормализует строку для поиска: нижний регистр, лишние пробелы убраны */
function normalizeSearch(s: string): string {
  return s.toLowerCase().replace(/\s+/g, " ").trim();
}

/** Ключевые слова формы: квадрат/прямоугольник → rectangular, круг → round. Поддерживаем префиксы. */
const SHAPE_RECT: [string, number][] = [
  ["квадрат", 3],
  ["прямоугольник", 3],
];
const SHAPE_ROUND: [string, number][] = [["круг", 3]];

/** Проверяет, есть ли в запросе слово-префикс или полное ключевое слово формы */
function queryMatchesShapeKeywords(
  queryNorm: string,
  keywords: [string, number][]
): boolean {
  const words = queryNorm.split(/\s+/).filter(Boolean);
  return keywords.some(
    ([kw, minLen]) =>
      queryNorm.includes(kw) || words.some((w) => w.length >= minLen && kw.startsWith(w))
  );
}

/** Удаляет из запроса слова, связанные с формой */
function stripShapeWords(queryNorm: string): string {
  const allKw = [...SHAPE_RECT, ...SHAPE_ROUND];
  let out = queryNorm;
  for (const [kw] of allKw) {
    out = out.replace(new RegExp(kw + "[а-яё]*", "gi"), " ");
  }
  for (const [kw, minLen] of allKw) {
    const words = out.split(/\s+/).filter(Boolean);
    out = words
      .filter((w) => !(w.length >= minLen && kw.startsWith(w)))
      .join(" ");
  }
  return out.replace(/\s+/g, " ").trim();
}

/** Расстояние Левенштейна (редакционное): вставка, удаление, замена = 1 */
function levenshtein(a: string, b: string): number {
  const an = a.length;
  const bn = b.length;
  if (an === 0) return bn;
  if (bn === 0) return an;
  let prev = Array.from({ length: bn + 1 }, (_, i) => i);
  for (let i = 1; i <= an; i++) {
    const curr = [i];
    for (let j = 1; j <= bn; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
    }
    prev = curr;
  }
  return prev[bn];
}

const FUZZY_MIN_LEN = 4;
const FUZZY_MAX_EDIT = 1;

/** Проверяет, совпадает ли слово с полем: точная подстрока или одно опечатка (для слов от 4 символов) */
function wordMatchesField(word: string, normField: string): boolean {
  if (normField.includes(word)) return true;
  if (word.length < FUZZY_MIN_LEN) return false;
  const tokens = normField.split(/\s+/).filter(Boolean);
  for (const token of tokens) {
    if (Math.abs(token.length - word.length) > FUZZY_MAX_EDIT) continue;
    if (levenshtein(token, word) <= FUZZY_MAX_EDIT) return true;
  }
  return false;
}

/** Поиск по словам: подстрока или нечёткое совпадение (1 опечатка для слов от 4 символов) */
function fieldsMatchWords(fields: string[], words: string[]): boolean {
  if (words.length === 0) return true;
  const normFields = fields.map((f) => normalizeSearch(f));
  return words.every((w) => normFields.some((f) => wordMatchesField(w, f)));
}

function coinMatchesSearch(coin: CatalogCoin, queryNorm: string): boolean {
  if (!queryNorm || queryNorm.length < 2) return true;
  const wantRect = queryMatchesShapeKeywords(queryNorm, SHAPE_RECT);
  const wantRound = queryMatchesShapeKeywords(queryNorm, SHAPE_ROUND);
  if (wantRect || wantRound) {
    const shapeOk = wantRect ? !!coin.rectangular : wantRound ? !coin.rectangular : true;
    const textQuery = stripShapeWords(queryNorm);
    if (!textQuery) return shapeOk;
    const fields = [
      coin.title,
      coin.seriesName,
      coin.country,
      coin.faceValue,
      coin.metalCode,
      coin.metalLabel,
      coin.mintName,
      coin.mintShort,
    ].filter(Boolean) as string[];
    const words = textQuery.split(/\s+/).filter((w) => w.length >= 2);
    const textOk = words.length === 0 ? true : fieldsMatchWords(fields, words);
    return shapeOk && textOk;
  }
  const fields = [
    coin.title,
    coin.seriesName,
    coin.country,
    coin.faceValue,
    coin.metalCode,
    coin.metalLabel,
    coin.mintName,
    coin.mintShort,
  ].filter(Boolean) as string[];
  const words = queryNorm.split(/\s+/).filter((w) => w.length >= 2);
  if (words.length === 0) return queryNorm.length >= 2 ? fieldsMatchWords(fields, [queryNorm]) : false;
  return fieldsMatchWords(fields, words);
}

function CatalogPageContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const [filter, setFilter] = useState<CatalogFilter>(() => parseCatalogState(searchParams).filter);
  const [filtersOpen, setFiltersOpen] = useState(() => parseCatalogState(searchParams).filtersOpen);
  const [filtersOpening, setFiltersOpening] = useState(false);
  const [filtersClosing, setFiltersClosing] = useState(false);
  const [isXl, setIsXl] = useState(false);
  const [coins, setCoins] = useState<CatalogCoin[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [displayedCount, setDisplayedCount] = useState(PAGE_SIZE);
  const [loading, setLoading] = useState(true);
  const [eyesAnimationData, setEyesAnimationData] = useState<object | null>(null);
  const [starAnimationData, setStarAnimationData] = useState<object | null>(null);
  const [showSkeletons, setShowSkeletons] = useState(true);
  const [sidebarFiltersActive, setSidebarFiltersActive] = useState(false);
  const [sidebarResetKey, setSidebarResetKey] = useState(0);
  const [selectedMetals, setSelectedMetals] = useState<string[]>(() => parseCatalogState(searchParams).selectedMetals);
  const [selectedWeights, setSelectedWeights] = useState<string[]>(() => parseCatalogState(searchParams).selectedWeights);
  const [selectedCountries, setSelectedCountries] = useState<string[]>(() => parseCatalogState(searchParams).selectedCountries);
  const [selectedSeries, setSelectedSeries] = useState<string[]>(() => parseCatalogState(searchParams).selectedSeries);
  const [selectedMints, setSelectedMints] = useState<string[]>(() => parseCatalogState(searchParams).selectedMints);
  const [searchQuery, setSearchQuery] = useState<string>(() => parseCatalogState(searchParams).searchQuery);
  const [sort, setSort] = useState<CatalogSort>(() => parseCatalogState(searchParams).sort);
  const [sortOpen, setSortOpen] = useState(false);
  const [sortBottomOpen, setSortBottomOpen] = useState(false);
  const [showScrollTop, setShowScrollTop] = useState(false);
  const sortDropdownRef = useRef<HTMLDivElement>(null);
  const sliderRef = useRef<HTMLDivElement | null>(null);
  const filterWrapperRef = useRef<HTMLDivElement | null>(null);
  const filterAsideRef = useRef<HTMLElement | null>(null);
  const { isAuthorized, inCollection, addToCollection, removeFromCollection } = useAuth();
  const handleToggleCollection = useCallback((id: string) => {
    if (inCollection(id)) removeFromCollection(id);
    else addToCollection(id);
  }, [inCollection, addToCollection, removeFromCollection]);

  // При «Назад» URL меняется — подтягиваем состояние из URL
  useEffect(() => {
    const parsed = parseCatalogState(searchParams);
    setFilter(parsed.filter);
    setFiltersOpen(parsed.filtersOpen);
    setSort(parsed.sort);
    setSelectedMetals(parsed.selectedMetals);
    setSelectedWeights(parsed.selectedWeights);
    setSelectedCountries(parsed.selectedCountries);
    setSelectedSeries(parsed.selectedSeries);
    setSelectedMints(parsed.selectedMints);
    setSearchQuery(parsed.searchQuery);
  }, [searchParams]);

  // Сохранение фильтров, сортировки и панели в URL (только при изменении)
  useEffect(() => {
    const params = new URLSearchParams();
    if (filter !== "all") params.set("tab", filter);
    if (filtersOpen) params.set("open", "1");
    if (sort !== "new") params.set("sort", sort);
    selectedMetals.forEach((m) => params.append("metal", m));
    selectedWeights.forEach((w) => params.append("weight", w));
    selectedCountries.forEach((c) => params.append("country", c));
    selectedSeries.forEach((s) => params.append("series", s));
    selectedMints.forEach((m) => params.append("mint", m));
    if (searchQuery) params.set("q", searchQuery);
    const q = params.toString();
    const current = searchParams.toString();
    const catalogUrl = `/catalog${q ? `?${q}` : ""}`;
    if (typeof window !== "undefined") sessionStorage.setItem("catalogReturnUrl", catalogUrl);
    if (q !== current) router.replace(catalogUrl, { scroll: false });
  }, [filter, filtersOpen, sort, selectedMetals, selectedWeights, selectedCountries, selectedSeries, selectedMints, searchQuery, router, searchParams]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    import("../../lib/fetchCoins").then(({ fetchCoinsList }) =>
      fetchCoinsList()
        .then((data) => {
          if (cancelled) return;
          const list = (data.coins ?? []) as CatalogCoin[];
          setCoins(list);
          setTotalCount(data.total ?? list.length);
        })
        .catch(() => {
          if (!cancelled) setCoins([]);
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        })
    );
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (filtersOpening) {
      const t = requestAnimationFrame(() => setFiltersOpening(false));
      return () => cancelAnimationFrame(t);
    }
  }, [filtersOpening]);

  const showPanel = filtersOpen || filtersClosing;

  useEffect(() => {
    const mq = window.matchMedia("(min-width: 1280px)");
    setIsXl(mq.matches);
    const onChange = () => setIsXl(mq.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  useEffect(() => {
    fetch("/animations/Eyes.json")
      .then((res) => res.json())
      .then(setEyesAnimationData)
      .catch(() => {});
  }, []);
  useEffect(() => {
    fetch("/animations/DizzyStar.json")
      .then((res) => res.json())
      .then(setStarAnimationData)
      .catch(() => {});
  }, []);

  // Скелетоны на 1 с при первой загрузке
  useEffect(() => {
    const t = setTimeout(() => setShowSkeletons(false), SKELETON_DURATION_MS);
    return () => clearTimeout(t);
  }, []);
  const allRef = useRef<HTMLButtonElement | null>(null);
  const ruRef = useRef<HTMLButtonElement | null>(null);
  const foreignRef = useRef<HTMLButtonElement | null>(null);
  const sentinelRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const updateSlider = () => {
      const el = filter === "all" ? allRef.current : filter === "ru" ? ruRef.current : foreignRef.current;
      if (!el || !sliderRef.current) return;
      sliderRef.current.style.left = `${el.offsetLeft}px`;
      sliderRef.current.style.width = `${el.offsetWidth}px`;
    };
    updateSlider();
    requestAnimationFrame(updateSlider);
    const t = setTimeout(updateSlider, 0);
    const parent = allRef.current?.parentElement ?? ruRef.current?.parentElement ?? foreignRef.current?.parentElement;
    const ro = parent ? new ResizeObserver(updateSlider) : null;
    if (ro && parent) ro.observe(parent);
    return () => {
      clearTimeout(t);
      ro?.disconnect();
    };
  }, [filter, loading]);

  const seriesListByCount = useMemo(() => {
    const m: Record<string, number> = {};
    coins.forEach((c) => {
      const s = c.seriesName?.trim();
      if (s) m[s] = (m[s] ?? 0) + 1;
    });
    return Object.entries(m)
      .sort((a, b) => b[1] - a[1])
      .map(([name]) => name);
  }, [coins]);

  /** «Два двора» → одиночные дворы; монета показывается при фильтре по любому из них */
const MINT_COMBINED_TO_SINGLES: Record<string, string[]> = {
  "Московский и Санкт-Петербургский монетные дворы": [
    "Московский монетный двор",
    "Санкт-Петербургский монетный двор",
  ],
  "Московский и Ленинградский монетные дворы": [
    "Московский монетный двор",
    "Ленинградский монетный двор",
  ],
};

function coinMatchesMint(coin: CatalogCoin, selectedMint: string): boolean {
  const name = coin.mintName?.trim();
  if (!name) return false;
  if (name === selectedMint) return true;
  const singles = MINT_COMBINED_TO_SINGLES[name];
  return singles?.includes(selectedMint) ?? false;
}

/** Список только одиночных дворов (без «X и Y монетные дворы»), счётчик включает монеты с двумя дворами */
const mintListByCount = useMemo(() => {
    const m: Record<string, number> = {};
    coins.forEach((c) => {
      const name = c.mintName?.trim();
      if (!name) return;
      const singles = MINT_COMBINED_TO_SINGLES[name];
      if (singles) {
        singles.forEach((s) => {
          m[s] = (m[s] ?? 0) + 1;
        });
      } else {
        m[name] = (m[name] ?? 0) + 1;
      }
    });
    return Object.entries(m)
      .sort((a, b) => b[1] - a[1])
      .map(([name]) => name);
  }, [coins]);

  const byTab =
    filter === "all" ? coins : filter === "ru" ? coins.filter((c) => c.country === "Россия") : coins.filter((c) => c.country !== "Россия");

  const searchNorm = useMemo(() => normalizeSearch(searchQuery), [searchQuery]);

  /** Применяет фильтры (вес, страна, серия, металл, поиск) к списку монет — как для чипсов в фильтрах */
  const applyFiltersTo = useCallback(
    (list: CatalogCoin[]) => {
      let out = list;
      if (selectedWeights.length > 0) out = out.filter((c) => c.weightLabel && selectedWeights.includes(c.weightLabel));
      if (selectedCountries.length > 0) out = out.filter((c) => selectedCountries.includes(c.country));
      if (selectedSeries.length > 0) out = out.filter((c) => c.seriesName && selectedSeries.includes(c.seriesName));
      if (selectedMints.length > 0) out = out.filter((c) => selectedMints.some((m) => coinMatchesMint(c, m)));
      if (selectedMetals.length > 0) {
        out = out.filter((c) =>
          c.metalCodes?.length
            ? selectedMetals.some((m) => c.metalCodes!.includes(m))
            : !!(c.metalCode && selectedMetals.includes(c.metalCode))
        );
      }
      if (searchNorm) out = out.filter((c) => coinMatchesSearch(c, searchNorm));
      return out;
    },
    [selectedWeights, selectedCountries, selectedSeries, selectedMints, selectedMetals, searchNorm]
  );

  /** Счётчики по вкладкам с учётом фильтров — как в чипсах металлов */
  const tabCounts = useMemo(
    () => ({
      all: applyFiltersTo(coins).length,
      ru: applyFiltersTo(coins.filter((c) => c.country === "Россия")).length,
      foreign: applyFiltersTo(coins.filter((c) => c.country !== "Россия")).length,
    }),
    [coins, applyFiltersTo]
  );
  const byWeight =
    selectedWeights.length === 0
      ? byTab
      : byTab.filter((c) => c.weightLabel && selectedWeights.includes(c.weightLabel));
  const byCountryFilter =
    selectedCountries.length === 0
      ? byWeight
      : byWeight.filter((c) => selectedCountries.includes(c.country));
  const bySeriesFilter =
    selectedSeries.length === 0
      ? byCountryFilter
      : byCountryFilter.filter((c) => c.seriesName && selectedSeries.includes(c.seriesName));
  const byMintFilter =
    selectedMints.length === 0
      ? bySeriesFilter
      : bySeriesFilter.filter((c) => selectedMints.some((m) => coinMatchesMint(c, m)));
  const afterMetal =
    selectedMetals.length === 0
      ? byMintFilter
      : byMintFilter.filter((c) =>
          c.metalCodes?.length
            ? selectedMetals.some((m) => c.metalCodes!.includes(m))
            : !!(c.metalCode && selectedMetals.includes(c.metalCode))
        );
  const filteredCoins = searchNorm
    ? afterMetal.filter((c) => coinMatchesSearch(c, searchNorm))
    : afterMetal;
  const sortedCoins = useMemo(() => {
    const list = [...filteredCoins];
    if (sort === "new") list.sort((a, b) => b.year - a.year);
    else if (sort === "old") list.sort((a, b) => a.year - b.year);
    else if (sort === "weight_desc") list.sort((a, b) => (b.weightG ?? 0) - (a.weightG ?? 0));
    else if (sort === "weight_asc") list.sort((a, b) => (a.weightG ?? 0) - (b.weightG ?? 0));
    return list;
  }, [filteredCoins, sort]);
  /** Для подсчёта в чипсах: монеты с учётом веса, страны, серии, монетного двора и поиска (без металла). */
  const coinsForFilterCounts = useMemo(
    () => (searchNorm ? byMintFilter.filter((c) => coinMatchesSearch(c, searchNorm)) : byMintFilter),
    [byMintFilter, searchNorm]
  );
  const displayedCoins = sortedCoins.slice(0, displayedCount);
  const hasMore = displayedCount < sortedCoins.length;

  const loadMore = useCallback(() => {
    if (!hasMore) return;
    setDisplayedCount((prev) => Math.min(prev + PAGE_SIZE, sortedCoins.length));
  }, [hasMore, sortedCoins.length]);

  useEffect(() => {
    setDisplayedCount(PAGE_SIZE);
  }, [filter, sort, selectedMetals, selectedWeights, selectedCountries, selectedSeries, selectedMints, searchQuery]);

  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel || !hasMore) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) loadMore();
      },
      { rootMargin: "800px", threshold: 0 }
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [hasMore, loadMore, showSkeletons]);

  useEffect(() => {
    const onScroll = () => setShowScrollTop(typeof window !== "undefined" && window.scrollY > 500);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  // Ozon-style: relative пока не дошли до низа блока, затем fixed bottom 0
  useEffect(() => {
    if (!isXl) return;
    const wrapper = filterWrapperRef.current;
    const aside = filterAsideRef.current;
    if (!wrapper || !aside) return;

    const updatePosition = () => {
      const rect = wrapper.getBoundingClientRect();
      const wrapperTop = rect.top + window.scrollY;
      const wrapperHeight = wrapper.offsetHeight;
      const asideHeight = aside.offsetHeight;
      const vh = window.innerHeight;
      const scrollY = window.scrollY;
      const reachedBottom = scrollY + vh >= wrapperTop + asideHeight;
      const pastColumn = scrollY >= wrapperTop + wrapperHeight - vh;

      if (pastColumn) {
        aside.style.position = "relative";
        aside.style.top = `${wrapperHeight - asideHeight}px`;
        aside.style.left = "";
        aside.style.width = "";
        aside.style.bottom = "";
      } else if (reachedBottom) {
        aside.style.position = "fixed";
        aside.style.bottom = "0";
        aside.style.top = "auto";
        aside.style.left = `${rect.left}px`;
        aside.style.width = `${rect.width}px`;
      } else {
        aside.style.position = "relative";
        aside.style.top = "0";
        aside.style.left = "";
        aside.style.width = "";
        aside.style.bottom = "";
      }
    };

    updatePosition();
    window.addEventListener("scroll", updatePosition, { passive: true });
    window.addEventListener("resize", updatePosition);
    return () => {
      window.removeEventListener("scroll", updatePosition);
      window.removeEventListener("resize", updatePosition);
    };
  }, [isXl, showPanel]);

  return (
    <div className="min-h-screen bg-white">
      <Header activePath="/catalog" />

      <main className="w-full px-4 sm:px-6 lg:px-20 pt-6 pb-20">
        <h1 className="text-black text-[28px] sm:text-[36px] font-semibold leading-tight mb-2">
          Каталог монет
        </h1>
        <p className="text-[#656565] text-[16px] font-normal mb-8 max-w-[640px] lg:max-w-[720px]">
          {nbspAfterPrepositions(
            "Российские и иностранные монеты из драгоценных металлов"
          )}
        </p>
        {/* Панель: свитчер + сортировка + фильтры и поиск — без скелетона, сразу реальные элементы */}
        <div className="mt-6 flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <>
          <div className="flex lg:inline-flex w-full lg:w-auto relative rounded-[300px] bg-[#F1F1F2] p-1 cursor-pointer flex-nowrap">
            <div
              ref={sliderRef}
              className="absolute top-1 bottom-1 rounded-[300px] bg-white transition-all duration-200 ease-out"
            />
            <button
              type="button"
              onClick={() => setFilter("all")}
              ref={allRef}
              className="relative z-10 flex-1 lg:flex-initial min-w-0 lg:min-w-[140px] px-3 lg:px-6 py-2 font-medium cursor-pointer text-center flex flex-col items-center gap-0.5"
            >
              <span className="text-[16px] leading-[18px]">Все</span>
              <span className="text-[#666666] text-[13px] leading-[16px] lg:text-[14px]">{formatNumber(tabCounts.all)}</span>
            </button>
            <button
              type="button"
              onClick={() => setFilter("ru")}
              ref={ruRef}
              className="relative z-10 flex-1 lg:flex-initial min-w-0 lg:min-w-[140px] px-3 lg:px-6 py-2 font-medium cursor-pointer text-center flex flex-col items-center gap-0.5"
            >
              <span className="text-[16px] leading-[18px]">Российские</span>
              <span className="text-[#666666] text-[13px] leading-[16px] lg:text-[14px]">{formatNumber(tabCounts.ru)}</span>
            </button>
            <button
              type="button"
              onClick={() => setFilter("foreign")}
              ref={foreignRef}
              className="relative z-10 flex-1 lg:flex-initial min-w-0 lg:min-w-[140px] px-3 lg:px-6 py-2 font-medium cursor-pointer text-center flex flex-col items-center gap-0.5"
            >
              <span className="text-[16px] leading-[18px]">Иностранные</span>
              <span className="text-[#666666] text-[13px] leading-[16px] lg:text-[14px]">{formatNumber(tabCounts.foreign)}</span>
            </button>
          </div>

          <div className="flex items-center justify-end gap-3 w-full lg:w-auto shrink-0">
              {/* Обёртка только для кнопки сортировки и дропдауна — дропдаун выровнен по правому краю кнопки */}
              <div className="relative">
                <Button
                  variant="ghost"
                  leftIcon={<IconArrowsSort size={24} stroke={2} />}
                  onClick={() => {
                    if (typeof window !== "undefined" && window.innerWidth >= 1024) {
                      setSortOpen((v) => !v);
                      setSortBottomOpen(false);
                    } else {
                      setSortBottomOpen((v) => !v);
                      setSortOpen(false);
                    }
                  }}
                  aria-label="Сортировка"
                  aria-expanded={sortOpen || sortBottomOpen}
                  className="rounded-full w-10 h-10 p-0 min-w-0 lg:rounded-[300px] lg:w-auto lg:px-4 lg:py-3"
                >
                  <span className="hidden lg:inline">Сортировка</span>
                </Button>
                {sortOpen && (
                  <>
                    <div
                      className="fixed inset-0 z-40"
                      aria-hidden
                      onClick={() => setSortOpen(false)}
                    />
                    <div
                      ref={sortDropdownRef}
                      className="absolute top-full right-0 mt-2 z-50 min-w-[220px] py-1 rounded-2xl bg-white border border-[#E4E4EA] shadow-lg hidden lg:block"
                    >
                      {SORT_OPTIONS.map((opt) => (
                        <label
                          key={opt.value}
                          className={`flex items-center gap-3 px-4 py-2.5 text-[16px] font-medium cursor-pointer rounded-xl mx-1 transition-colors ${sort === opt.value ? "bg-[#F1F1F2] text-[#11111B]" : "text-[#11111B] hover:bg-[#F1F1F2]"}`}
                        >
                          <span
                            className={`w-5 h-5 rounded-full border-2 shrink-0 flex items-center justify-center ${sort === opt.value ? "border-[#11111B]" : "border-[#E4E4EA]"}`}
                          >
                            {sort === opt.value && (
                              <span className="w-2.5 h-2.5 rounded-full bg-[#11111B]" />
                            )}
                          </span>
                          <span>{opt.label}</span>
                          <input
                            type="radio"
                            name="catalog-sort"
                            value={opt.value}
                            checked={sort === opt.value}
                            onChange={() => {
                              setSort(opt.value);
                              setSortOpen(false);
                            }}
                            className="sr-only"
                          />
                        </label>
                      ))}
                    </div>
                  </>
                )}
              </div>
              <Button
                variant="ghost"
                leftIcon={<IconAdjustmentsHorizontal size={24} stroke={2} />}
                onClick={() => {
                  if (filtersOpen) {
                    setFiltersOpen(false);
                    setFiltersClosing(true);
                    setTimeout(() => setFiltersClosing(false), FILTERS_TRANSITION_MS);
                  } else {
                    setFiltersOpen(true);
                    setFiltersOpening(true);
                  }
                }}
                className="rounded-full w-10 h-10 p-0 min-w-0 lg:rounded-[300px] lg:w-auto lg:px-4 lg:py-3"
              >
                <span className="inline-flex items-center gap-1 whitespace-nowrap">
                  <span className="hidden lg:inline">Фильтры и поиск</span>
                  {selectedMetals.length + selectedWeights.length + selectedCountries.length + selectedSeries.length + selectedMints.length > 0 && (
                    <span
                      className="inline-flex items-center justify-center w-[22px] h-[22px] shrink-0 rounded-full bg-[#11111B] text-white text-[14px] font-medium leading-none"
                      aria-label="Выбрано фильтров"
                    >
                      {selectedMetals.length + selectedWeights.length + selectedCountries.length + selectedSeries.length + selectedMints.length}
                    </span>
                  )}
                </span>
              </Button>
            </div>
          </>
        </div>

        {/* Одна сетка 5 колонок на xl: панель = 1 колонка (сразу полная ширина), карточки 4 или 5 колонок — перестраиваются только правые */}
        <div
          className={`mt-6 ${showPanel && isXl ? "lg:grid lg:grid-cols-5 lg:gap-6" : ""}`}
        >
          <div
            className={
              showPanel && isXl
                ? "lg:col-span-4 min-w-0 flex flex-col"
                : "min-w-0 flex flex-col"
            }
            style={!loading && filteredCoins.length === 0 ? { minHeight: "100vh" } : undefined}
          >
            {!loading && filteredCoins.length === 0 ? (
              filter === "foreign" && coins.filter((c) => c.country !== "Россия").length === 0 ? (
                <div className="flex-1 min-h-0 flex flex-col items-center justify-center py-16 pb-32 lg:pb-[440px] px-4 text-center">
                  <div className="w-[168px] h-[168px] mb-6 flex items-center justify-center">
                    {starAnimationData ? (
                      <Lottie animationData={starAnimationData} loop style={{ width: 168, height: 168 }} />
                    ) : (
                      <div className="w-full h-full rounded-full bg-[#E4E4EA]" aria-hidden />
                    )}
                  </div>
                  <h3 className="text-black text-[24px] font-semibold mb-2">Ожидается пополнение</h3>
                  <p className="text-[#666666] text-[18px] leading-[1.4] max-w-[360px]">
                    Скоро здесь появятся иностранные монеты
                  </p>
                </div>
              ) : (
                <div className="flex-1 min-h-0 flex flex-col items-center justify-center py-16 pb-32 lg:pb-[440px] px-4 text-center">
                  <div className="w-[168px] h-[168px] mb-6 flex items-center justify-center">
                    {eyesAnimationData ? (
                      <Lottie animationData={eyesAnimationData} loop style={{ width: 168, height: 168 }} />
                    ) : (
                      <div className="w-full h-full rounded-full bg-[#E4E4EA]" aria-hidden />
                    )}
                  </div>
                  <p className="text-[#666666] text-[18px] leading-[1.4] max-w-[360px]">
                    По вашему запросу монеты не найдены
                  </p>
                  <button
                    type="button"
                    onClick={() => {
                      setFilter("all");
                      setSelectedMetals([]);
                      setSelectedWeights([]);
                      setSelectedCountries([]);
                      setSelectedSeries([]);
                      setSelectedMints([]);
                      setSearchQuery("");
                      setSidebarFiltersActive(false);
                      setSidebarResetKey((k) => k + 1);
                      setShowSkeletons(true);
                      setTimeout(() => setShowSkeletons(false), SKELETON_DURATION_MS);
                    }}
                    className="mt-6 px-6 py-3 rounded-[300px] bg-[#11111B] text-white text-[16px] font-medium hover:opacity-90 transition-opacity cursor-pointer"
                  >
                    Сбросить фильтры
                  </button>
                </div>
              )
            ) : (
              <>
                <div
                  className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-3 xl:grid-cols-5 gap-6 md:gap-x-6 md:gap-y-3 lg:gap-x-6 lg:gap-y-3 xl:gap-6"
                  style={
                    isXl
                      ? {
                          gridTemplateColumns: showPanel ? "repeat(4, 1fr)" : "repeat(5, 1fr)",
                          transition: `grid-template-columns ${FILTERS_TRANSITION_MS}ms ease-out`,
                        }
                      : undefined
                  }
                >
                  {showSkeletons
                    ? Array.from({ length: SKELETON_COUNT_DESKTOP }, (_, i) => (
                        <div
                          key={`skeleton-${i}`}
                          className={
                            i < SKELETON_COUNT_MOBILE
                              ? ""
                              : i < SKELETON_COUNT_TABLET
                                ? "hidden md:block"
                                : "hidden xl:block"
                          }
                        >
                          <CoinCardSkeleton />
                        </div>
                      ))
                    : displayedCoins.map((coin, index) => (
                        <div
                          key={coin.id}
                          style={{
                            animation: "catalog-card-enter 0.3s ease forwards",
                            animationDelay: `${(index % PAGE_SIZE) * 0.05}s`,
                            opacity: 0,
                          }}
                        >
                          <CoinCard
                            {...coin}
                            href={`/coins/${coin.id}/`}
                            isAuthorized={isAuthorized}
                            inCollection={inCollection(coin.id)}
                            onToggleCollection={handleToggleCollection}
                          />
                        </div>
                      ))}
                </div>
                {!showSkeletons && hasMore && <div ref={sentinelRef} className="h-4 w-full" aria-hidden />}
              </>
            )}
          </div>
          {/* Десктоп: колонка фильтров справа */}
          {showPanel && isXl && (
            <div
              ref={filterWrapperRef}
              className="lg:col-span-1 lg:col-start-5 min-w-0 overflow-hidden lg:row-span-full"
            >
              <aside ref={filterAsideRef} className="w-full lg:relative">
                <CatalogFilters
                  key={sidebarResetKey}
                  slide={filtersOpening || (filtersClosing && !filtersOpen)}
                  onFiltersActiveChange={setSidebarFiltersActive}
                  coins={coinsForFilterCounts}
                  selectedMetals={selectedMetals}
                  onMetalChange={setSelectedMetals}
                  selectedWeights={selectedWeights}
                  onWeightChange={setSelectedWeights}
                  selectedCountries={selectedCountries}
                  onCountryChange={setSelectedCountries}
                  seriesList={seriesListByCount}
                  selectedSeries={selectedSeries}
                  onSeriesChange={setSelectedSeries}
                  mintList={mintListByCount}
                  selectedMints={selectedMints}
                  onMintChange={setSelectedMints}
                  searchQuery={searchQuery}
                  onSearchChange={setSearchQuery}
                />
              </aside>
            </div>
          )}
        </div>

        {/* Мобильная панель сортировки: нижний бар */}
        {sortBottomOpen && (
          <>
            <div
              className="fixed inset-0 z-40 lg:hidden bg-black/20"
              aria-hidden
              onClick={() => setSortBottomOpen(false)}
            />
            <div
              className="fixed bottom-0 left-0 right-0 z-50 lg:hidden bg-white rounded-t-2xl shadow-[0_-4px_20px_rgba(0,0,0,0.08)] pb-[env(safe-area-inset-bottom)]"
              style={{
                transition: `transform ${FILTERS_TRANSITION_MS}ms ease-out`,
                transform: sortBottomOpen ? "translateY(0)" : "translateY(100%)",
              }}
            >
              <div className="h-2 w-12 mx-auto mt-2 rounded-full bg-[#E4E4EA] shrink-0" aria-hidden />
              <p className="text-[#666666] text-[14px] font-normal px-4 pt-2 pb-3">Сортировка</p>
              <div className="flex flex-col px-4 pb-4 gap-1">
                {SORT_OPTIONS.map((opt) => (
                  <label
                    key={opt.value}
                    className={`flex items-center gap-3 w-full px-4 py-3 text-[16px] font-medium rounded-2xl cursor-pointer transition-colors ${sort === opt.value ? "bg-[#F1F1F2] text-[#11111B]" : "text-[#11111B] hover:bg-[#F1F1F2] active:bg-[#E4E4EA]"}`}
                  >
                    <span
                      className={`w-5 h-5 rounded-full border-2 shrink-0 flex items-center justify-center ${sort === opt.value ? "border-[#11111B]" : "border-[#E4E4EA]"}`}
                    >
                      {sort === opt.value && (
                        <span className="w-2.5 h-2.5 rounded-full bg-[#11111B]" />
                      )}
                    </span>
                    <span>{opt.label}</span>
                    <input
                      type="radio"
                      name="catalog-sort-mobile"
                      value={opt.value}
                      checked={sort === opt.value}
                      onChange={() => {
                        setSort(opt.value);
                        setSortBottomOpen(false);
                      }}
                      className="sr-only"
                    />
                  </label>
                ))}
              </div>
            </div>
          </>
        )}

        {/* Мобильная панель фильтров: оверлей с выдвижкой */}
        {showPanel && !isXl && (
          <>
            <div
              className="fixed inset-0 z-40 bg-black/20 lg:hidden"
              aria-hidden
              onClick={() => {
                setFiltersOpen(false);
                setFiltersClosing(true);
                setTimeout(() => setFiltersClosing(false), FILTERS_TRANSITION_MS);
              }}
            />
            <div
              className="fixed top-0 right-0 bottom-0 z-50 w-full max-w-[400px] bg-white shadow-xl lg:hidden flex flex-col"
              style={{
                transform: filtersClosing ? "translateX(100%)" : "translateX(0)",
                transition: `transform ${FILTERS_TRANSITION_MS}ms ease-out`,
              }}
            >
              <div className="h-[72px] flex items-center justify-between px-4 border-b border-[#E4E4EA] shrink-0">
                <span className="text-[18px] font-medium">Фильтры и поиск</span>
                <button
                  type="button"
                  onClick={() => {
                    setFiltersOpen(false);
                    setFiltersClosing(true);
                    setTimeout(() => setFiltersClosing(false), FILTERS_TRANSITION_MS);
                  }}
                  className="p-2 rounded-lg hover:bg-[#F1F1F2] cursor-pointer"
                  aria-label="Закрыть"
                >
                  <IconX size={28} stroke={2} />
                </button>
              </div>
              <div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden">
                <CatalogFilters
                  key={sidebarResetKey}
                  slide={filtersOpening || (filtersClosing && !filtersOpen)}
                  onFiltersActiveChange={setSidebarFiltersActive}
                  coins={coinsForFilterCounts}
                  selectedMetals={selectedMetals}
                  onMetalChange={setSelectedMetals}
                  selectedWeights={selectedWeights}
                  onWeightChange={setSelectedWeights}
                  selectedCountries={selectedCountries}
                  onCountryChange={setSelectedCountries}
                  seriesList={seriesListByCount}
                  selectedSeries={selectedSeries}
                  onSeriesChange={setSelectedSeries}
                  mintList={mintListByCount}
                  selectedMints={selectedMints}
                  onMintChange={setSelectedMints}
                  searchQuery={searchQuery}
                  onSearchChange={setSearchQuery}
                />
              </div>
            </div>
          </>
        )}
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

function CatalogPageFallback() {
  return (
    <div className="min-h-screen bg-white">
      <Header activePath="/catalog" />
      <main className="w-full px-4 sm:px-6 lg:px-20 pt-6 pb-20">
        <h1 className="text-black text-[28px] sm:text-[36px] font-semibold leading-tight mb-2">
          Каталог монет
        </h1>
        <p className="text-[#656565] text-[16px] font-normal mb-8 max-w-[640px] lg:max-w-[720px]">
          {nbspAfterPrepositions(
            "Российские и иностранные монеты из драгоценных металлов"
          )}
        </p>
        {/* Та же панель, что и в контенте — без мигания и серого блока при перезагрузке */}
        <div className="mt-6 flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex lg:inline-flex w-full lg:w-auto relative rounded-[300px] bg-[#F1F1F2] p-1 flex-nowrap pointer-events-none">
            <div className="absolute top-1 bottom-1 left-1 rounded-[300px] bg-white w-1/3 lg:w-[140px]" aria-hidden />
            <div className="relative z-10 flex-1 lg:flex-initial min-w-0 lg:min-w-[140px] px-3 lg:px-6 py-2 font-medium text-center flex flex-col items-center gap-0.5">
              <span className="text-[16px] leading-[18px]">Все</span>
              <span className="text-[#666666] text-[13px] leading-[16px] lg:text-[14px]">{formatNumber(0)}</span>
            </div>
            <div className="relative z-10 flex-1 lg:flex-initial min-w-0 lg:min-w-[140px] px-3 lg:px-6 py-2 font-medium text-center flex flex-col items-center gap-0.5">
              <span className="text-[16px] leading-[18px]">Российские</span>
              <span className="text-[#666666] text-[13px] leading-[16px] lg:text-[14px]">{formatNumber(0)}</span>
            </div>
            <div className="relative z-10 flex-1 lg:flex-initial min-w-0 lg:min-w-[140px] px-3 lg:px-6 py-2 font-medium text-center flex flex-col items-center gap-0.5">
              <span className="text-[16px] leading-[18px]">Иностранные</span>
              <span className="text-[#666666] text-[13px] leading-[16px] lg:text-[14px]">{formatNumber(0)}</span>
            </div>
          </div>
          <div className="flex items-center justify-end gap-3 w-full lg:w-auto shrink-0 pointer-events-none">
            <Button
              variant="ghost"
              leftIcon={<IconArrowsSort size={24} stroke={2} />}
              className="rounded-full w-10 h-10 p-0 min-w-0 lg:rounded-[300px] lg:w-auto lg:px-4 lg:py-3"
              aria-hidden
            >
              <span className="hidden lg:inline">Сортировка</span>
            </Button>
            <Button
              variant="ghost"
              leftIcon={<IconAdjustmentsHorizontal size={24} stroke={2} />}
              className="rounded-full w-10 h-10 p-0 min-w-0 lg:rounded-[300px] lg:w-auto lg:px-4 lg:py-3"
              aria-hidden
            >
              <span className="hidden lg:inline">Фильтры и поиск</span>
            </Button>
          </div>
        </div>
        <div className="mt-6 grid grid-cols-2 md:grid-cols-3 lg:grid-cols-3 xl:grid-cols-5 gap-6 md:gap-x-6 md:gap-y-3 lg:gap-x-6 lg:gap-y-3 xl:gap-6">
          {Array.from({ length: SKELETON_COUNT_DESKTOP }, (_, i) => (
            <div
              key={i}
              className={
                i < SKELETON_COUNT_MOBILE
                  ? ""
                  : i < SKELETON_COUNT_TABLET
                    ? "hidden md:block"
                    : "hidden xl:block"
              }
            >
              <CoinCardSkeleton />
            </div>
          ))}
        </div>
      </main>
    </div>
  );
}

export default function CatalogPage() {
  return (
    <Suspense fallback={<CatalogPageFallback />}>
      <CatalogPageContent />
    </Suspense>
  );
}
