"use client";

import { useState, useMemo, useEffect, useRef } from "react";
import { nbspAfterPrepositions } from "../../lib/nbspPrepositions";
import { Header } from "../../components/Header";

type DataPoint = { label: string; value: number };

type ApiResponse = {
  ok: boolean;
  period?: string;
  source?: "cbr";
  XAU?: DataPoint[];
  XAG?: DataPoint[];
  XPT?: DataPoint[];
  XPD?: DataPoint[];
  XCU?: DataPoint[];
  error?: string;
};

const SKELETON_DURATION_MS = 1000;

let METAL_PRICES_STATIC_CACHE: Record<string, ApiResponse | number> | null = null;
let METAL_PRICES_STATIC_CACHE_PROMISE: Promise<Record<string, ApiResponse | number> | null> | null = null;

async function getMetalPricesStaticJson(): Promise<Record<string, ApiResponse | number> | null> {
  if (METAL_PRICES_STATIC_CACHE) return METAL_PRICES_STATIC_CACHE;
  if (!METAL_PRICES_STATIC_CACHE_PROMISE) {
    METAL_PRICES_STATIC_CACHE_PROMISE = fetch("/data/metal-prices.json")
      .then((r) => (r.ok ? r.json() : null))
      .then((data: Record<string, ApiResponse | number> | null) => {
        METAL_PRICES_STATIC_CACHE = data;
        return data;
      })
      .catch(() => null);
  }
  return METAL_PRICES_STATIC_CACHE_PROMISE;
}

/** Металлы: XAU, XPT, XPD, XAG — ЦБ; XCU — медь (RusCable), те же даты что и у драгметаллов. Pt и Pd — цвет серебра для видимости. */
const CHART_SILVER = "#C0C0C0";
/** Бледный серый для ховера у Ag/Pt/Pd, чтобы отличался от линии цвета серебра */
const CHART_HOVER_GRAY_LIGHT = "#E8E8EC";
const CHART_HOVER_GRAY = "#D4D4D8";
const METALS = [
  { code: "Au", name: "Золото", color: "#D4AF37", apiSymbol: "XAU" as const },
  { code: "Pt", name: "Платина", color: CHART_SILVER, apiSymbol: "XPT" as const },
  { code: "Pd", name: "Палладий", color: CHART_SILVER, apiSymbol: "XPD" as const },
  { code: "Ag", name: "Серебро", color: CHART_SILVER, apiSymbol: "XAG" as const },
  { code: "Cu", name: "Медь", color: "#B87333", apiSymbol: "XCU" as const },
] as const;

export type ChartPeriod = "1m" | "1y" | "5y" | "10y" | "all";

const PERIODS: { value: ChartPeriod; label: string }[] = [
  { value: "1m", label: "Месяц" },
  { value: "1y", label: "Год" },
  { value: "5y", label: "5 лет" },
  { value: "10y", label: "10 лет" },
  { value: "all", label: "Все" },
];

/** Подпись периода для блока «рост/падение за период» */
const PERIOD_LABEL: Record<ChartPeriod, string> = {
  "1m": "За месяц",
  "1y": "За год",
  "5y": "За 5 лет",
  "10y": "За 10 лет",
  "all": "За весь период",
};

const PERIOD_LENGTHS: Record<ChartPeriod, number> = {
  "1m": 30,
  "1y": 12,
  "5y": 5,
  "10y": 10,
  "all": 22,
};

/** Демо-данные по периоду для скелетона (форма линии до загрузки). */
function getDemoData(metalCode: string, period: ChartPeriod): DataPoint[] {
  const seed = metalCode.charCodeAt(0) + metalCode.charCodeAt(1);
  const base = metalCode === "Au" ? 6000 : metalCode === "Ag" ? 80 : metalCode === "Pt" ? 3000 : metalCode === "Pd" ? 2500 : metalCode === "Cu" ? 70 : 70;
  const n = PERIOD_LENGTHS[period];
  return Array.from({ length: n }, (_, i) => {
    const t = i / (n - 1) || 0;
    const trend = Math.sin(t * Math.PI * 2 + seed * 0.1) * 0.08;
    const noise = Math.sin(i * 2.1 + seed) * 0.02;
    const value = Math.round(base * (1 + trend + noise) * 100) / 100;
    let label: string;
    if (period === "1m") label = `${i + 1}`;
    else if (period === "1y") {
      const d = new Date(); d.setMonth(d.getMonth() - (n - 1 - i));
      label = d.toLocaleDateString("ru-RU", { month: "short", year: "2-digit" });
    } else {
      const d = new Date(); d.setFullYear(d.getFullYear() - (n - 1 - i));
      label = d.getFullYear().toString();
    }
    return { label, value };
  });
}

const CHART_WIDTH = 320;
const CHART_HEIGHT = 160;
const PADDING = { top: 8, right: 40, bottom: 24, left: 8 };
const MORPH_DURATION_MS = 220;

/** Ресэмпл к N точкам (для морфинга при разном числе точек: неделя → 10 лет) */
function sampleToN(points: { x: number; y: number }[], n: number): { x: number; y: number }[] {
  if (points.length === 0) return [];
  if (points.length === 1) return Array.from({ length: n }, () => ({ x: points[0].x, y: points[0].y }));
  return Array.from({ length: n }, (_, i) => {
    const t = i / (n - 1);
    const idx = t * (points.length - 1);
    const lo = Math.floor(idx);
    const hi = Math.min(lo + 1, points.length - 1);
    const f = idx - lo;
    return {
      x: points[lo].x + (points[hi].x - points[lo].x) * f,
      y: points[lo].y + (points[hi].y - points[lo].y) * f,
    };
  });
}

function easeOutCubic(t: number): number {
  return 1 - (1 - t) ** 3;
}

/** Формат подписи оси Y: тысячи как "2.85K", остальное как число */
function formatPriceLabel(value: number): string {
  if (value >= 1000) return `${(value / 1000).toFixed(2)}K`;
  return value.toLocaleString("ru-RU", { maximumFractionDigits: 0 });
}

const GRAMS_PER_TROY_OZ = 31.1035;

/** Пересчёт значения для отображения: валюта (RUB/USD) и единица (гр/унция). XAU,XAG,XPT,XPD в API — руб/г, XCU — руб/унция. */
function convertDisplayValue(
  value: number,
  apiSymbol: string,
  currency: "RUB" | "USD",
  unit: "gr" | "oz",
  usdRub: number | null
): number {
  const isCu = apiSymbol === "XCU";
  let v = value;
  if (isCu) {
    if (unit === "gr") v = value / GRAMS_PER_TROY_OZ;
  } else {
    if (unit === "oz") v = value * GRAMS_PER_TROY_OZ;
  }
  if (currency === "USD" && usdRub != null && usdRub > 0) v = v / usdRub;
  return Math.round(v * 100) / 100;
}

function MetalChart({
  metal,
  currency,
  setCurrency,
  unit,
  setUnit,
  usdRub,
}: {
  metal: (typeof METALS)[number];
  currency: "RUB" | "USD";
  setCurrency: (c: "RUB" | "USD") => void;
  unit: "gr" | "oz";
  setUnit: (u: "gr" | "oz") => void;
  usdRub: number | null;
}) {
  const [period, setPeriod] = useState<ChartPeriod>("1y");
  const [apiData, setApiData] = useState<DataPoint[] | null>(null);
  const [dataSource, setDataSource] = useState<"cbr" | "static" | null>(null);
  const [loading, setLoading] = useState(true);
  const [showSkeletons, setShowSkeletons] = useState(true);
  const skeletonStartMsRef = useRef<number>(Date.now());
  const firstLoadRef = useRef(true);
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  const sliderRef = useRef<HTMLDivElement | null>(null);
  const periodRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const pathRef = useRef<SVGPathElement | null>(null);
  const [animatedPathCoords, setAnimatedPathCoords] = useState<{ x: number; y: number }[]>([]);
  const animatedPathRef = useRef<{ x: number; y: number }[]>([]);

  useEffect(() => {
    const updateSlider = () => {
      const idx = PERIODS.findIndex((p) => p.value === period);
      const el = idx >= 0 ? periodRefs.current[idx] : null;
      if (!el || !sliderRef.current) return;
      sliderRef.current.style.left = `${el.offsetLeft}px`;
      sliderRef.current.style.width = `${el.offsetWidth}px`;
    };
    updateSlider();
    requestAnimationFrame(updateSlider);
    const t = setTimeout(updateSlider, 0);
    const parent = periodRefs.current[0]?.parentElement;
    const ro = parent ? new ResizeObserver(updateSlider) : null;
    if (ro && parent) ro.observe(parent);
    return () => {
      clearTimeout(t);
      ro?.disconnect();
    };
  }, [period, showSkeletons]);

  useEffect(() => {
    let cancelled = false;
    const isFirstLoad = firstLoadRef.current;
    if (isFirstLoad) {
      skeletonStartMsRef.current = Date.now();
      setShowSkeletons(true);
    }
    setLoading(true);

    // Сначала статичный JSON (обновляется кроном), при отсутствии — API
    getMetalPricesStaticJson()
      .then((byPeriod) => {
        const raw = byPeriod?.[period];
        const periodData = raw && typeof raw === "object" && "ok" in raw ? (raw as ApiResponse) : null;
        if (periodData?.ok && periodData[metal.apiSymbol!]) {
          if (cancelled) return;
          setApiData(periodData[metal.apiSymbol!]!);
          setDataSource(periodData.source ?? "static");
          return;
        }
        return fetch(`/api/metal-prices?period=${period}`).then((r) => r.json() as Promise<ApiResponse>);
      })
      .then((res) => {
        if (cancelled || res === undefined) return;
        if (res?.ok && res[metal.apiSymbol!]) {
          setApiData(res[metal.apiSymbol!]!);
          setDataSource(res.source ?? null);
        } else {
          setApiData(null);
          setDataSource(null);
        }
      })
      .catch(() => {
        if (cancelled) return;
        setApiData(null);
        setDataSource(null);
      })
      .finally(() => {
        if (cancelled) return;
        setLoading(false);
        if (isFirstLoad) {
          const elapsed = Date.now() - skeletonStartMsRef.current;
          const waitMs = Math.max(0, SKELETON_DURATION_MS - elapsed);
          window.setTimeout(() => {
            if (!cancelled) {
              setShowSkeletons(false);
              firstLoadRef.current = false;
            }
          }, waitMs);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [period, metal.apiSymbol]);

  const demoData = useMemo(() => getDemoData(metal.code, period), [metal.code, period]);

  const data = useMemo(() => {
    if (!apiData?.length || !metal.apiSymbol) return [];
    return apiData.map((d) => ({
      label: d.label,
      value: convertDisplayValue(d.value, metal.apiSymbol!, currency, unit, usdRub),
    }));
  }, [apiData, currency, unit, usdRub, metal.apiSymbol]);

  const showSkeleton = showSkeletons;
  const showError = !showSkeletons && !loading && !apiData?.length;

  const hasData = data.length > 0;
  const min = hasData ? Math.min(...data.map((d) => d.value)) : 0;
  const max = hasData ? Math.max(...data.map((d) => d.value)) : 1;
  const range = max - min || 1;
  const innerW = CHART_WIDTH - PADDING.left - PADDING.right;
  const innerH = CHART_HEIGHT - PADDING.top - PADDING.bottom;

  const coords = hasData
    ? data.map((d, i) => {
        const x = PADDING.left + (i / (data.length - 1 || 1)) * innerW;
        const y = PADDING.top + innerH - ((d.value - min) / range) * innerH;
        return { x, y, value: d.value };
      })
    : [];

  const pathCoords = useMemo(() => coords.map((c) => ({ x: c.x, y: c.y })), [coords]);

  const demoChart = useMemo(() => {
    if (!demoData.length) return { coords: [] as { x: number; y: number }[], yTicks: [] as number[] };
    const dmin = Math.min(...demoData.map((d) => d.value));
    const dmax = Math.max(...demoData.map((d) => d.value));
    const drange = dmax - dmin || 1;
    const dcoords = demoData.map((d, i) => {
      const x = PADDING.left + (i / (demoData.length - 1 || 1)) * innerW;
      const y = PADDING.top + innerH - ((d.value - dmin) / drange) * innerH;
      return { x, y };
    });
    const dyTicks = [dmin, dmin + drange / 3, dmin + (2 * drange) / 3, dmax];
    return { coords: dcoords, yTicks: dyTicks };
  }, [demoData, innerH, innerW]);

  useEffect(() => {
    animatedPathRef.current = animatedPathCoords;
  }, [animatedPathCoords]);

  useEffect(() => {
    // Пока показываем скелетон — держим "демо-линию" как старт для будущей анимации
    if (showSkeleton) {
      if (demoChart.coords.length > 0) setAnimatedPathCoords(demoChart.coords);
      return;
    }
    if (pathCoords.length === 0) return;
    const start = animatedPathRef.current;
    if (start.length === 0) {
      // Если почему-то старт пустой — берём демо как базу, чтобы морфинг был заметен
      if (demoChart.coords.length > 0) setAnimatedPathCoords(demoChart.coords);
    }
    const from = start.length === pathCoords.length ? start : sampleToN(start, pathCoords.length);
    const startTime = performance.now();
    let rafId: number;
    const tick = () => {
      const t = Math.min((performance.now() - startTime) / MORPH_DURATION_MS, 1);
      const eased = easeOutCubic(t);
      setAnimatedPathCoords(
        from.map((s, i) => ({
          x: s.x + (pathCoords[i].x - s.x) * eased,
          y: s.y + (pathCoords[i].y - s.y) * eased,
        }))
      );
      if (t < 1) rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, [pathCoords, showSkeleton, demoChart]);

  const allPath = animatedPathCoords.length
    ? `M ${animatedPathCoords.map((c) => `${c.x},${c.y}`).join(" L ")}`
    : "";

  // Четыре деления по оси Y: мин и макс за период, между ними два промежуточных (диапазон понятен)
  const yTicks = [min, min + range / 3, min + (2 * range) / 3, max];

  const startPrice = hasData ? (data[0]?.value ?? 0) : 0;

  const displayIndex = hasData ? (hoveredIndex ?? data.length - 1) : 0;
  const displayPoint = data[displayIndex];
  const isHovering = hoveredIndex !== null;

  // Рост/падение от начала периода до текущей (или наведённой) точки
  const changeFromStart = (displayPoint?.value ?? 0) - startPrice;
  const changePercentFromStart = startPrice !== 0 ? (changeFromStart / startPrice) * 100 : 0;
  const isPositiveFromStart = changeFromStart >= 0;

  const displayIndexInPath =
    data.length > 1 && animatedPathCoords.length > 1
      ? Math.min(
          animatedPathCoords.length - 1,
          Math.round((displayIndex / (data.length - 1)) * (animatedPathCoords.length - 1))
        )
      : 0;
  const activePathDisplay =
    animatedPathCoords.length > 0
      ? `M ${animatedPathCoords
          .slice(0, displayIndexInPath + 1)
          .map((c) => `${c.x},${c.y}`)
          .join(" L ")}`
      : "";
  const hoverPoint =
    animatedPathCoords.length > 0 && displayIndexInPath < animatedPathCoords.length
      ? animatedPathCoords[displayIndexInPath]
      : null;

  const updateHoverFromClientX = (clientX: number) => {
    if (data.length === 0 || loading) return;
    const svg = svgRef.current;
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    const scale = Math.min(rect.width / CHART_WIDTH, rect.height / CHART_HEIGHT);
    const offsetX = (rect.width - CHART_WIDTH * scale) / 2;
    const svgX = (clientX - rect.left - offsetX) / scale;
    const t = (svgX - PADDING.left) / innerW;
    const rawIndex = t * (data.length - 1);
    const index = Math.round(Math.max(0, Math.min(data.length - 1, rawIndex)));
    setHoveredIndex(index);
  };

  const handleChartMouseMove = (e: React.MouseEvent<SVGSVGElement>) => {
    updateHoverFromClientX(e.clientX);
  };

  const handleChartTouchMove = (e: React.TouchEvent<SVGSVGElement>) => {
    if (!e.touches.length) return;
    e.preventDefault(); // блокируем скролл страницы при движении пальца по графику
    updateHoverFromClientX(e.touches[0].clientX);
  };

  const handleChartTouchStart = (e: React.TouchEvent<SVGSVGElement>) => {
    if (!e.touches.length) return;
    e.preventDefault(); // блокируем скролл страницы при касании графика (просмотр цен)
    updateHoverFromClientX(e.touches[0].clientX);
  };

  const handleChartMouseLeave = () => setHoveredIndex(null);
  const handleChartTouchEnd = () => setHoveredIndex(null);

  const hoverGray = metal.color === CHART_SILVER ? CHART_HOVER_GRAY_LIGHT : CHART_HOVER_GRAY;

  return (
    <div className={`rounded-2xl border border-[#E4E4EA] p-4 sm:p-5 bg-white ${showSkeleton ? "skeleton-pulse-opacity" : ""}`}>
      {showSkeleton ? (
        <div aria-hidden>
          <div className="mb-3">
            <div className="flex items-center gap-2">
              <div className="h-5 w-28 rounded-[300px] bg-[#E4E4EA]" />
              <div className="h-4 w-12 rounded-[300px] bg-[#E4E4EA]" />
            </div>
          </div>
          <div className="h-9 w-48 rounded-[300px] bg-[#E4E4EA] mb-2" />
          <div className="flex flex-wrap items-center gap-2 mb-4">
            <div className="h-4 w-20 rounded-[300px] bg-[#E4E4EA]" />
            <div className="h-5 w-16 rounded-[300px] bg-[#E4E4EA]" />
            <div className="h-4 w-24 rounded-[300px] bg-[#E4E4EA]" />
          </div>
          <div className="rounded-xl w-full aspect-[2/1] overflow-hidden relative">
            <svg
              viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`}
              className="w-full h-full"
              preserveAspectRatio="xMidYMid meet"
              aria-hidden
            >
              {/* Скелетон-сетка */}
              {demoChart.yTicks.map((value, i) => {
                const dmin = demoChart.yTicks[0] ?? 0;
                const dmax = demoChart.yTicks[demoChart.yTicks.length - 1] ?? 1;
                const drange = dmax - dmin || 1;
                const y =
                  PADDING.top + innerH - ((value - dmin) / drange) * innerH;
                return (
                  <g key={i}>
                    <line
                      x1={PADDING.left}
                      y1={y}
                      x2={CHART_WIDTH - PADDING.right}
                      y2={y}
                      stroke="#E4E4EA"
                      strokeWidth="1"
                    />
                    <rect
                      x={CHART_WIDTH - PADDING.right + 2}
                      y={y - 6}
                      width={18 + i * 4}
                      height={10}
                      rx={5}
                      fill="#E4E4EA"
                    />
                  </g>
                );
              })}
              {/* Скелетон-линия графика */}
              {demoChart.coords.length > 0 && (
                <path
                  d={`M ${demoChart.coords
                    .map((c) => `${c.x},${c.y}`)
                    .join(" L ")}`}
                  fill="none"
                  stroke="#E4E4EA"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              )}
            </svg>
          </div>
          <div className="mt-4 flex w-full max-w-full relative rounded-[300px] bg-[#F1F1F2] p-1">
            <div className="flex w-full gap-1">
                {PERIODS.map((p, i) => (
                <div
                  key={p.value}
                  className={`flex-1 h-7 rounded-[300px] ${
                    i === 1 ? "bg-white" : "bg-[#E4E4EA]"
                  }`}
                />
              ))}
            </div>
          </div>
        </div>
      ) : showError ? (
        <>
          <div className="mb-3">
            <h2 className="text-[18px] font-semibold text-black leading-tight">
              {metal.name}
              {metal.apiSymbol && <span className="text-[#666666] font-normal text-[16px] ml-1">{metal.apiSymbol}</span>}
            </h2>
          </div>
          <p className="text-[#666666] text-[16px] leading-[1.5]">
            Не удалось загрузить данные по ценам металлов. Попробуйте обновить страницу.
          </p>
        </>
      ) : (
        <>
          <div className="mb-3 flex items-start justify-between gap-2">
            <h2 className="text-[18px] font-semibold text-black leading-tight">
              {metal.name}
              {metal.apiSymbol && <span className="text-[#666666] font-normal text-[16px] ml-1">{metal.apiSymbol}</span>}
            </h2>
            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={() => setCurrency(currency === "RUB" ? "USD" : "RUB")}
                className="text-[#666666] hover:text-black text-[14px] font-medium transition-colors"
                title={
                  currency === "RUB"
                    ? usdRub != null && usdRub > 0
                      ? "Показать в долларах"
                      : "Курс доллара не загружен — обновите страницу"
                    : "Показать в рублях"
                }
                aria-pressed={currency === "USD"}
              >
                {currency === "RUB" ? "₽" : "$"}
              </button>
              <span className="text-[#666666] text-[14px]">·</span>
              <button
                type="button"
                onClick={() => setUnit(unit === "gr" ? "oz" : "gr")}
                className="text-[#666666] hover:text-black text-[14px] font-medium transition-colors"
                title={unit === "gr" ? "Показать за унцию" : "Показать за грамм"}
                aria-pressed={unit === "oz"}
              >
                {unit === "gr" ? "гр." : "унция"}
              </button>
            </div>
          </div>
          <p className="text-[28px] sm:text-[32px] font-bold text-black leading-tight mb-1">
            {(displayPoint?.value ?? 0).toLocaleString("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}{" "}
            {currency === "RUB" ? "₽" : "$"}
          </p>
          <div className="flex flex-wrap items-center gap-2 mb-4">
            <span className={isPositiveFromStart ? "text-[#16A34A]" : "text-[#DC2626]"} style={{ fontSize: "14px" }}>
              {(isPositiveFromStart ? "+" : "") + changeFromStart.toLocaleString("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}{" "}
              {currency === "RUB" ? "₽" : "$"}
            </span>
            <span
              className={`inline-flex items-center gap-0.5 rounded-[300px] px-2 py-0.5 text-[13px] font-medium ${isPositiveFromStart ? "bg-[#DCFCE7] text-[#16A34A]" : "bg-[#FEE2E2] text-[#DC2626]"}`}
            >
              {isPositiveFromStart ? "↑" : "↓"}
              {Math.abs(changePercentFromStart).toFixed(2) + "%"}
            </span>
            <span className="text-[#666666] text-[14px]">
              {isHovering && displayPoint ? displayPoint.label : PERIOD_LABEL[period]}
            </span>
          </div>

          {/* touch-action: none — на мобильном/планшете при касании графика страница не скроллится */}
          <div className="touch-none" style={{ touchAction: "none" }}>
            <svg
              ref={svgRef}
              viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`}
              className={`w-full max-w-full h-auto transition-opacity duration-200 cursor-crosshair ${loading ? "opacity-50" : ""}`}
              preserveAspectRatio="xMidYMid meet"
              aria-hidden
              onMouseMove={handleChartMouseMove}
              onMouseLeave={handleChartMouseLeave}
              onTouchStart={handleChartTouchStart}
              onTouchMove={handleChartTouchMove}
              onTouchEnd={handleChartTouchEnd}
              onTouchCancel={handleChartTouchEnd}
            >
              {/* Горизонтальные линии сетки и подписи цен справа — 4 деления */}
              {yTicks.map((value, i) => {
                const y = PADDING.top + innerH - ((value - min) / range) * innerH;
                return (
                  <g key={i}>
                    <line
                      x1={PADDING.left}
                      y1={y}
                      x2={CHART_WIDTH - PADDING.right}
                      y2={y}
                      stroke="#E4E4EA"
                      strokeWidth="1"
                    />
                    <text
                      x={CHART_WIDTH - PADDING.right + 4}
                      y={y}
                      textAnchor="start"
                      dominantBaseline="middle"
                      fill="#666666"
                      fontSize="10"
                    >
                      {formatPriceLabel(value)}
                    </text>
                  </g>
                );
              })}
              {/* Без наведения: одна линия цветом металла. При наведении: серая вся + цветной участок до точки, вертикальная линия и кружок */}
              {allPath && !isHovering && (
                <path
                  ref={pathRef}
                  d={allPath}
                  fill="none"
                  stroke={metal.color}
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              )}
              {isHovering && allPath && (
                <path
                  d={allPath}
                  fill="none"
                  stroke={hoverGray}
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              )}
              {isHovering && activePathDisplay && (
                <path
                  d={activePathDisplay}
                  fill="none"
                  stroke={metal.color}
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              )}
              {isHovering && hoverPoint && (
                <>
                  <line
                    x1={hoverPoint.x}
                    y1={PADDING.top}
                    x2={hoverPoint.x}
                    y2={PADDING.top + innerH}
                    stroke={hoverGray}
                    strokeWidth="1"
                  />
                  <circle
                    cx={hoverPoint.x}
                    cy={hoverPoint.y}
                    r="5"
                    fill={metal.color}
                    stroke="white"
                    strokeWidth="2"
                  />
                </>
              )}
            </svg>
          </div>

          <div className="mt-4 flex w-full max-w-full relative rounded-[300px] bg-[#F1F1F2] p-1">
            <div
              ref={sliderRef}
              className="absolute top-1 bottom-1 rounded-[300px] bg-white transition-all duration-200 ease-out"
              aria-hidden
            />
            {PERIODS.map((p, i) => (
              <button
                key={p.value}
                type="button"
                ref={(el) => { periodRefs.current[i] = el; }}
                onClick={() => setPeriod(p.value)}
                className="relative z-10 flex-1 min-w-0 px-3 py-2 text-[14px] font-medium cursor-pointer text-center rounded-[300px] transition-colors text-[#11111B] hover:opacity-80"
              >
                {p.label}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

export default function ChartsPage() {
  const [currency, setCurrency] = useState<"RUB" | "USD">("RUB");
  const [unit, setUnit] = useState<"gr" | "oz">("gr");
  const [usdRub, setUsdRub] = useState<number | null>(null);

  useEffect(() => {
    getMetalPricesStaticJson().then((data) => {
      if (data && typeof (data as Record<string, unknown>).usdRub === "number") {
        setUsdRub((data as Record<string, unknown>).usdRub as number);
        return;
      }
      // Локально или старый JSON без usdRub — подтягиваем курс с ЦБ (тот же источник, что и крон)
      fetch("https://www.cbr-xml-daily.ru/daily_json.js")
        .then((r) => (r.ok ? r.json() : null))
        .then((cbr: { Valute?: { USD?: { Value?: number } } } | null) => {
          const v = cbr?.Valute?.USD?.Value;
          if (typeof v === "number" && v > 0) setUsdRub(Math.round(v * 100) / 100);
        })
        .catch(() => {});
    });
  }, []);

  return (
    <div className="min-h-screen bg-white">
      <Header activePath="/charts" />

      <main className="w-full px-4 sm:px-6 lg:px-8 2xl:px-20 pt-6 pb-24">
        <article className="w-full max-w-[720px] lg:max-w-none mx-auto flex flex-col gap-8">
          <header>
            <h1 className="text-black text-[28px] sm:text-[36px] font-semibold leading-tight mb-2">
              Графики металлов
            </h1>
          <p className="text-[#656565] text-[16px] font-normal mb-8 max-w-[640px] lg:max-w-[720px]">
            {nbspAfterPrepositions(
              "Динамика цен за грамм на драгоценные металлы и медь. По ним удобно смотреть тренды и ориентироваться при оценке монет."
            )}
          </p>
          </header>

          <div className="grid grid-cols-1 lg:grid-cols-2 2xl:grid-cols-3 gap-6">
            {METALS.map((metal) => (
              <MetalChart
                key={metal.code}
                metal={metal}
                currency={currency}
                setCurrency={setCurrency}
                unit={unit}
                setUnit={setUnit}
                usdRub={usdRub}
              />
            ))}
          </div>
        </article>
      </main>
    </div>
  );
}
