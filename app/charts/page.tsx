"use client";

import { useState, useMemo, useEffect, useRef } from "react";
import Link from "next/link";
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
  error?: string;
};

/** Металлы из фильтров каталога. В API: XAU, XPT, XPD, XAG. Медь (Cu) — только демо. Pt и Pd — цвет серебра для лучшей видимости на графиках. */
const CHART_SILVER = "#C0C0C0";
/** Бледный серый для ховера у Ag/Pt/Pd, чтобы отличался от линии цвета серебра */
const CHART_HOVER_GRAY_LIGHT = "#E8E8EC";
const CHART_HOVER_GRAY = "#D4D4D8";
const METALS = [
  { code: "Au", name: "Золото", color: "#D4AF37", apiSymbol: "XAU" as const },
  { code: "Pt", name: "Платина", color: CHART_SILVER, apiSymbol: "XPT" as const },
  { code: "Pd", name: "Палладий", color: CHART_SILVER, apiSymbol: "XPD" as const },
  { code: "Ag", name: "Серебро", color: CHART_SILVER, apiSymbol: "XAG" as const },
  { code: "Cu", name: "Медь", color: "#B87333", apiSymbol: null },
] as const;

export type ChartPeriod = "1w" | "1m" | "1y" | "5y" | "10y";

const PERIODS: { value: ChartPeriod; label: string }[] = [
  { value: "1w", label: "Неделя" },
  { value: "1m", label: "Месяц" },
  { value: "1y", label: "Год" },
  { value: "5y", label: "5 лет" },
  { value: "10y", label: "10 лет" },
];

/** Подпись периода для блока «рост/падение за период» */
const PERIOD_LABEL: Record<ChartPeriod, string> = {
  "1w": "За неделю",
  "1m": "За месяц",
  "1y": "За год",
  "5y": "За 5 лет",
  "10y": "За 10 лет",
};

const PERIOD_LENGTHS: Record<ChartPeriod, number> = {
  "1w": 7,
  "1m": 30,
  "1y": 12,
  "5y": 5,
  "10y": 10,
};

/** Демо-данные по периоду: условные цены (для отображения тренда) */
function getDemoData(metalCode: string, period: ChartPeriod): DataPoint[] {
  const seed = metalCode.charCodeAt(0) + metalCode.charCodeAt(1);
  const base = metalCode === "Au" ? 6000 : metalCode === "Ag" ? 80 : metalCode === "Pt" ? 3000 : metalCode === "Pd" ? 2500 : 70;
  const n = PERIOD_LENGTHS[period];
  return Array.from({ length: n }, (_, i) => {
    const t = i / (n - 1) || 0;
    const trend = Math.sin(t * Math.PI * 2 + seed * 0.1) * 0.08;
    const noise = Math.sin(i * 2.1 + seed) * 0.02;
    const value = Math.round(base * (1 + trend + noise) * 100) / 100;
    let label: string;
    if (period === "1w") {
      const d = new Date(); d.setDate(d.getDate() - (n - 1 - i));
      label = d.toLocaleDateString("ru-RU", { day: "numeric", month: "short" });
    } else if (period === "1m") label = `${i + 1}`;
    else if (period === "1y") {
      const d = new Date(); d.setMonth(d.getMonth() - (n - 1 - i));
      label = d.toLocaleDateString("ru-RU", { month: "short" });
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

function MetalChart({ metal }: { metal: (typeof METALS)[number] }) {
  const [period, setPeriod] = useState<ChartPeriod>("1y");
  const [apiData, setApiData] = useState<DataPoint[] | null>(null);
  const [dataSource, setDataSource] = useState<"cbr" | null>(null);
  const [loading, setLoading] = useState(false);
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
  }, [period, loading]);

  useEffect(() => {
    if (metal.apiSymbol === null) {
      setApiData(null);
      setDataSource(null);
      return;
    }
    setLoading(true);
    fetch(`/api/metal-prices?period=${period}`)
      .then((r) => r.json() as Promise<ApiResponse>)
      .then((res) => {
        if (res.ok && res[metal.apiSymbol!]) {
          setApiData(res[metal.apiSymbol!]!);
          setDataSource(res.source ?? null);
        } else {
          setApiData(null);
          setDataSource(null);
        }
      })
      .catch(() => {
        setApiData(null);
        setDataSource(null);
      })
      .finally(() => setLoading(false));
  }, [period, metal.apiSymbol]);

  const data = useMemo(() => {
    if (metal.apiSymbol && apiData?.length) return apiData;
    return getDemoData(metal.code, period);
  }, [metal.code, metal.apiSymbol, period, apiData]);
  const min = Math.min(...data.map((d) => d.value));
  const max = Math.max(...data.map((d) => d.value));
  const range = max - min || 1;
  const innerW = CHART_WIDTH - PADDING.left - PADDING.right;
  const innerH = CHART_HEIGHT - PADDING.top - PADDING.bottom;

  const coords = data.map((d, i) => {
    const x = PADDING.left + (i / (data.length - 1 || 1)) * innerW;
    const y = PADDING.top + innerH - ((d.value - min) / range) * innerH;
    return { x, y, value: d.value };
  });

  const pathCoords = useMemo(() => coords.map((c) => ({ x: c.x, y: c.y })), [coords]);

  useEffect(() => {
    animatedPathRef.current = animatedPathCoords;
  }, [animatedPathCoords]);

  useEffect(() => {
    if (pathCoords.length === 0) return;
    const start = animatedPathRef.current;
    if (start.length === 0) {
      setAnimatedPathCoords(pathCoords);
      return;
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
  }, [pathCoords]);

  const allPath = animatedPathCoords.length
    ? `M ${animatedPathCoords.map((c) => `${c.x},${c.y}`).join(" L ")}`
    : "";

  // Четыре деления по оси Y: мин и макс за период, между ними два промежуточных (диапазон понятен)
  const yTicks = [
    min,
    min + range / 3,
    min + (2 * range) / 3,
    max,
  ];

  const startPrice = data[0]?.value ?? 0;

  const displayIndex = data.length > 0 ? (hoveredIndex ?? data.length - 1) : 0;
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

  const handleChartMouseMove = (e: React.MouseEvent<SVGSVGElement>) => {
    if (data.length === 0 || loading) return;
    const svg = svgRef.current;
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    const scale = Math.min(rect.width / CHART_WIDTH, rect.height / CHART_HEIGHT);
    const offsetX = (rect.width - CHART_WIDTH * scale) / 2;
    const svgX = (e.clientX - rect.left - offsetX) / scale;
    const t = (svgX - PADDING.left) / innerW;
    const rawIndex = t * (data.length - 1);
    const index = Math.round(Math.max(0, Math.min(data.length - 1, rawIndex)));
    setHoveredIndex(index);
  };

  const handleChartMouseLeave = () => setHoveredIndex(null);

  const hoverGray = metal.color === CHART_SILVER ? CHART_HOVER_GRAY_LIGHT : CHART_HOVER_GRAY;

  return (
    <div className="rounded-2xl border border-[#E4E4EA] p-4 sm:p-5 bg-white">
      <div className="mb-3">
        <h2 className="text-[18px] font-semibold text-black leading-tight">
          {metal.name}
          {metal.apiSymbol && <span className="text-[#666666] font-normal text-[16px] ml-1">{metal.apiSymbol}</span>}
        </h2>
      </div>
      <p className="text-[28px] sm:text-[32px] font-bold text-black leading-tight mb-1">
        {displayPoint != null ? (displayPoint.value ?? 0).toLocaleString("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "—"} ₽/г
      </p>
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <span className={isPositiveFromStart ? "text-[#16A34A]" : "text-[#DC2626]"} style={{ fontSize: "14px" }}>
          {displayPoint != null ? (isPositiveFromStart ? "+" : "") + changeFromStart.toLocaleString("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "—"} ₽
        </span>
        <span
          className={`inline-flex items-center gap-0.5 rounded-[300px] px-2 py-0.5 text-[13px] font-medium ${isPositiveFromStart ? "bg-[#DCFCE7] text-[#16A34A]" : "bg-[#FEE2E2] text-[#DC2626]"}`}
        >
          {isPositiveFromStart ? "↑" : "↓"}
          {displayPoint != null ? Math.abs(changePercentFromStart).toFixed(2) + "%" : "—"}
        </span>
        <span className="text-[#666666] text-[14px]">
          {isHovering && displayPoint ? displayPoint.label : PERIOD_LABEL[period]}
        </span>
      </div>
      <svg
        ref={svgRef}
        viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`}
        className={`w-full max-w-full h-auto transition-opacity duration-200 cursor-crosshair ${loading ? "opacity-50" : ""}`}
        preserveAspectRatio="xMidYMid meet"
        aria-hidden
        onMouseMove={handleChartMouseMove}
        onMouseLeave={handleChartMouseLeave}
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
    </div>
  );
}

export default function ChartsPage() {
  return (
    <div className="min-h-screen bg-white">
      <Header activePath="/charts" />

      <main className="w-full px-4 sm:px-6 lg:px-20 pb-24">
        <nav
          className="flex items-center gap-2 pt-6 text-[16px] font-medium text-[#666666]"
          aria-label="Хлебные крошки"
        >
          <Link href="/" className="hover:text-black">
            Главная
          </Link>
          <span>/</span>
          <span className="text-black">Графики</span>
        </nav>

        <article className="mt-8 w-full max-w-[720px] lg:max-w-none mx-auto flex flex-col gap-8">
          <header>
            <h1 className="text-black text-[28px] sm:text-[40px] font-semibold leading-tight mb-2">
              Графики металлов
            </h1>
            <p className="text-[#656565] text-[16px] font-normal mb-8 max-w-[640px] lg:max-w-[720px]">
              {nbspAfterPrepositions(
                "Графики показывают динамику цен на металлы из каталога монет: золото, серебро, платину, палладий и медь — в рублях за грамм. По ним удобно смотреть тренды и ориентироваться при оценке монет. По меди пока демо-данные."
              )}
            </p>
          </header>

          <div className="grid grid-cols-1 lg:grid-cols-2 2xl:grid-cols-3 gap-6">
            {METALS.map((metal) => (
              <MetalChart key={metal.code} metal={metal} />
            ))}
          </div>
        </article>
      </main>
    </div>
  );
}
