"use client";

import { useState, useEffect, useMemo } from "react";
import { IconSearch } from "@tabler/icons-react";
import { Button } from "./Button";
import { formatNumber, formatNumbersInString } from "../lib/formatNumber";

/** Иерархия: Серебро, Золото, Платина, Палладий, Медь */
const METAL_OPTIONS = [
  { label: "Ag", color: "#C0C0C0" },
  { label: "Au", color: "#FFD700" },
  { label: "Pt", color: "#E5E4E2" },
  { label: "Pd", color: "#CEC5B4" },
  { label: "Cu", color: "#97564A" },
];

// По умолчанию — самые распространённые; остальные по кнопке «Показать все»
const weightOptionsDefault = [
  "1 унция · 31,1 грамм",
  "1/2 унции · 15,55 грамм",
  "1/4 унции · 7,78 грамм",
  "1/8 унции · 3,89 грамм",
  "1/10 унции · 3,11 грамм",
];
const weightOptionsFull = [
  "5 кг · 5000 грамм",
  "3 кг · 3000 грамм",
  "1 кг · 1000 грамм",
  "10 унций · 311 г",
  "5 унций · 155,5 г",
  "3 унции · 93,3 г",
  "2 унции · 62,2 г",
  ...weightOptionsDefault,
  "1/25 унции · 1,24 грамм",
  "1/100 унции · 0,31 грамм",
  "1/200 унции · 0,156 грамм",
  "1/1000 унции · 0,031 грамм",
];

const countries = ["Россия", "Австралия", "Соединённые Штаты Америки (США)", "Германия"];
const COUNTRY_DISABLED = countries.filter((c) => c !== "Россия");

/** Вес: слева унции/кг, справа граммы (для раскладки space-between) */
const WEIGHT_LEFT: Record<string, string> = {
  "5 кг · 5000 грамм": "5 кг",
  "3 кг · 3000 грамм": "3 кг",
  "1 кг · 1000 грамм": "1 кг",
  "10 унций · 311 г": "10 oz",
  "5 унций · 155,5 г": "5 oz",
  "3 унции · 93,3 г": "3 oz",
  "2 унции · 62,2 г": "2 oz",
  "1 унция · 31,1 грамм": "1 oz",
  "1/2 унции · 15,55 грамм": "1/2 oz",
  "1/4 унции · 7,78 грамм": "1/4 oz",
  "1/8 унции · 3,89 грамм": "1/8 oz",
  "1/10 унции · 3,11 грамм": "1/10 oz",
  "1/25 унции · 1,24 грамм": "1/25 oz",
  "1/100 унции · 0,31 грамм": "1/100 oz",
  "1/200 унции · 0,156 грамм": "1/200 oz",
  "1/1000 унции · 0,031 грамм": "1/1000 oz",
};
const WEIGHT_RIGHT: Record<string, string> = {
  "5 кг · 5000 грамм": "5000 гр.",
  "3 кг · 3000 грамм": "3000 гр.",
  "1 кг · 1000 грамм": "1000 гр.",
  "10 унций · 311 г": "311 гр.",
  "5 унций · 155,5 г": "155,5 гр.",
  "3 унции · 93,3 г": "93,3 гр.",
  "2 унции · 62,2 г": "62,2 гр.",
  "1 унция · 31,1 грамм": "31,1 гр.",
  "1/2 унции · 15,55 грамм": "15,55 гр.",
  "1/4 унции · 7,78 грамм": "7,78 гр.",
  "1/8 унции · 3,89 грамм": "3,89 гр.",
  "1/10 унции · 3,11 грамм": "3,11 гр.",
  "1/25 унции · 1,24 грамм": "1,24 гр.",
  "1/100 унции · 0,31 грамм": "0,31 гр.",
  "1/200 унции · 0,156 грамм": "0,156 гр.",
  "1/1000 унции · 0,031 грамм": "0,031 гр.",
};

function FilterChecklist({
  items,
  selectedValues = [],
  onChange,
  disabledItems = [],
  getDisplayLabel,
  getDisplayLabelRight,
}: {
  items: string[];
  selectedValues?: string[];
  onChange: (values: string[]) => void;
  disabledItems?: string[];
  /** Опционально: подпись слева или единственная подпись */
  getDisplayLabel?: (item: string) => string;
  /** Опционально: подпись справа (вместе с getDisplayLabel даёт раскладку space-between) */
  getDisplayLabelRight?: (item: string) => string;
}) {
  const sel = selectedValues ?? [];
  const disabledSet = new Set(disabledItems);
  const toggle = (item: string) => {
    if (disabledSet.has(item)) return;
    if (sel.includes(item)) {
      onChange(sel.filter((v) => v !== item));
    } else {
      onChange([...sel, item]);
    }
  };
  return (
    <div className="flex flex-col gap-3">
      {items.map((item) => {
        const disabled = disabledSet.has(item);
        const leftLabel = getDisplayLabel ? getDisplayLabel(item) : item;
        const rightLabel = getDisplayLabelRight?.(item);
        return (
          <label
            key={item}
            className={`group flex items-center gap-3 ${disabled ? "cursor-not-allowed opacity-60" : "cursor-pointer"}`}
          >
            <span
              className={`w-5 h-5 rounded-[4px] border-2 shrink-0 flex items-center justify-center bg-transparent ${sel.includes(item) && !disabled ? "border-[#11111B]" : disabled ? "border-[#E4E4EA]" : "border-[#E4E4EA] group-hover:border-[#11111B]"}`}
            >
              {sel.includes(item) && !disabled && (
                <svg className="w-3 h-3" viewBox="0 0 12 12" fill="none" stroke="#11111B" strokeWidth={2}>
                  <path d="M2 6l3 3 5-6" />
                </svg>
              )}
            </span>
            <input
              type="checkbox"
              checked={sel.includes(item)}
              disabled={disabled}
              onChange={() => toggle(item)}
              className="sr-only"
            />
            {rightLabel != null ? (
              <span className="flex-1 flex items-center gap-2 min-w-0 min-h-[24px] text-[16px] font-normal leading-[22.4px]">
                <span className="shrink-0">{leftLabel}</span>
                <span className="flex-1 min-h-[24px] border-b border-[#E4E4EA] self-end mb-1" aria-hidden />
                <span className="shrink-0 text-[#666666]">{rightLabel}</span>
              </span>
            ) : (
              <span className="text-[16px] font-normal leading-[22.4px]">{leftLabel}</span>
            )}
          </label>
        );
      })}
    </div>
  );
}

type CatalogCoinForFilter = { id: string; metalCode?: string; metalCodes?: string[]; seriesName?: string; mintName?: string };
type CatalogFiltersProps = {
  slide?: boolean;
  onFiltersActiveChange?: (active: boolean) => void;
  coins?: CatalogCoinForFilter[];
  selectedMetals?: string[];
  onMetalChange?: (codes: string[]) => void;
  selectedWeights?: string[];
  onWeightChange?: (values: string[]) => void;
  selectedCountries?: string[];
  onCountryChange?: (values: string[]) => void;
  seriesList?: string[];
  selectedSeries?: string[];
  onSeriesChange?: (values: string[]) => void;
  mintList?: string[];
  selectedMints?: string[];
  onMintChange?: (values: string[]) => void;
  searchQuery?: string;
  onSearchChange?: (query: string) => void;
};

export function CatalogFilters({
  slide = false,
  onFiltersActiveChange,
  coins = [],
  selectedMetals = [],
  onMetalChange,
  selectedWeights = [],
  onWeightChange,
  selectedCountries = [],
  onCountryChange,
  seriesList = [],
  selectedSeries = [],
  onSeriesChange,
  mintList = [],
  selectedMints = [],
  onMintChange,
  searchQuery = "",
  onSearchChange,
}: CatalogFiltersProps) {
  const [weightListExpanded, setWeightListExpanded] = useState(false);
  const [seriesListExpanded, setSeriesListExpanded] = useState(false);

  const seriesDefault = seriesList.slice(0, 4);
  const metalsWithCount = useMemo(() => {
    const countByCode: Record<string, number> = {};
    METAL_OPTIONS.forEach((m) => (countByCode[m.label] = 0));
    coins.forEach((c) => {
      if (c.metalCodes?.length) {
        c.metalCodes.forEach((code) => { if (countByCode[code] !== undefined) countByCode[code]++; });
      } else if (c.metalCode && countByCode[c.metalCode] !== undefined) countByCode[c.metalCode]++;
    });
    return METAL_OPTIONS.map((m) => ({ ...m, count: countByCode[m.label] ?? 0 }));
  }, [coins]);

  const hasActiveFilters =
    selectedMetals.length > 0 ||
    selectedWeights.length > 0 ||
    selectedCountries.length > 0 ||
    selectedSeries.length > 0 ||
    selectedMints.length > 0;

  useEffect(() => {
    onFiltersActiveChange?.(hasActiveFilters);
  }, [hasActiveFilters, onFiltersActiveChange]);

  const handleMetalClick = (label: string) => {
    const next = selectedMetals.includes(label)
      ? selectedMetals.filter((c) => c !== label)
      : [...selectedMetals, label];
    onMetalChange?.(next);
  };

  const resetAll = () => {
    onMetalChange?.([]);
    onWeightChange?.([]);
    onCountryChange?.([]);
    onSeriesChange?.([]);
    onMintChange?.([]);
    onSearchChange?.("");
    onFiltersActiveChange?.(false);
  };

  return (
    <aside
      dir="ltr"
      className="w-full min-w-0 max-w-full pt-10 pb-5 px-4 rounded-2xl flex flex-col gap-6 shrink-0 transition-[transform] duration-300 ease-out overflow-x-hidden"
      style={{
        transform: slide ? "translateX(100%)" : "translateX(0)",
      }}
    >
      {/* Поиск */}
      <label
        htmlFor="catalog-search-input"
        className="flex items-center gap-2 px-4 py-2 bg-[#F1F1F2] rounded-[32px] border-2 border-transparent transition-colors cursor-pointer hover:bg-[#E4E4EA] focus-within:bg-white focus-within:border-[#11111B] focus-within:hover:bg-white"
      >
        <IconSearch size={24} stroke={2} className="shrink-0 pointer-events-none" />
        <input
          id="catalog-search-input"
          type="search"
          value={searchQuery}
          onChange={(e) => onSearchChange?.(e.target.value)}
          placeholder="Поиск"
          className="flex-1 min-w-0 bg-transparent text-[16px] leading-[18px] text-[#11111B] placeholder:text-[#666666] outline-none cursor-text"
          aria-label="Поиск монет"
        />
      </label>

      {/* Металл */}
      <div className="flex flex-col gap-4">
        <h3 className="text-black text-[20px] font-medium leading-7">Металлы</h3>
        <div className="flex flex-wrap gap-3">
          {metalsWithCount.map((m) => {
            const selected = selectedMetals.includes(m.label);
            const disabled = m.count === 0;
            return (
              <button
                key={m.label}
                type="button"
                disabled={disabled}
                onClick={() => !disabled && handleMetalClick(m.label)}
                className={`inline-flex items-center gap-1 px-3 py-2 rounded-[32px] text-[16px] font-normal transition-colors outline-none border-none ${
                  disabled ? "bg-[#F1F1F2] text-[#999] cursor-not-allowed opacity-60" : selected ? "bg-[#11111B] text-white cursor-pointer" : "bg-[#F1F1F2] cursor-pointer hover:bg-[#E4E4EA]"
                }`}
              >
                <span className={selected ? "text-white" : "text-[#11111B]"}>{formatNumber(m.count)}</span>
                <span
                  className="w-6 h-6 rounded-full flex items-center justify-center text-[12px] font-medium shrink-0 text-[#11111B]"
                  style={{ background: m.color }}
                >
                  {m.label}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Вес */}
      <div className="flex flex-col gap-4">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-black text-[20px] font-medium leading-7">Вес</h3>
          <button
            type="button"
            onClick={() => setWeightListExpanded((v) => !v)}
            className="text-[16px] font-normal leading-[22.4px] text-[#656565] shrink-0"
          >
            {weightListExpanded ? "Свернуть" : "Показать все"}
          </button>
        </div>
        <FilterChecklist
          items={weightListExpanded ? weightOptionsFull : weightOptionsDefault}
          selectedValues={selectedWeights}
          onChange={onWeightChange ?? (() => {})}
          getDisplayLabel={(item) => WEIGHT_LEFT[item] ?? item}
          getDisplayLabelRight={(item) => formatNumbersInString(WEIGHT_RIGHT[item] ?? "")}
        />
      </div>

      {/* Серия: из БД, топ-4 по умолчанию, затем «Показать все» */}
      <div className="flex flex-col gap-4">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-black text-[20px] font-medium leading-7">Серия</h3>
          {seriesList.length > 4 && (
            <button
              type="button"
              onClick={() => setSeriesListExpanded((v) => !v)}
              className="text-[16px] font-normal leading-[22.4px] text-[#656565] shrink-0"
            >
              {seriesListExpanded ? "Свернуть" : "Показать все"}
            </button>
          )}
        </div>
        <FilterChecklist
          items={seriesListExpanded ? seriesList : seriesDefault}
          selectedValues={selectedSeries}
          onChange={onSeriesChange ?? (() => {})}
        />
      </div>

      {/* Страна: только Россия активна */}
      <div className="flex flex-col gap-4">
        <h3 className="text-black text-[20px] font-medium leading-7">Страна</h3>
        <FilterChecklist
          items={countries}
          selectedValues={selectedCountries}
          onChange={onCountryChange ?? (() => {})}
          disabledItems={COUNTRY_DISABLED}
        />
      </div>

      {/* Монетный двор: из данных каталога */}
      {mintList.length > 0 && (
        <div className="flex flex-col gap-4">
          <h3 className="text-black text-[20px] font-medium leading-7">Монетный двор</h3>
          <FilterChecklist
            items={mintList}
            selectedValues={selectedMints}
            onChange={onMintChange ?? (() => {})}
          />
        </div>
      )}

      <Button type="button" variant="primary" className="w-full rounded-[300px]" onClick={resetAll}>
        Сбросить все
      </Button>
    </aside>
  );
}
