"use client";

import { useEffect, useRef } from "react";
import { formatNumber } from "../lib/formatNumber";

type RegionSliderProps = {
  value: "ru" | "foreign";
  onChange: (v: "ru" | "foreign") => void;
  /** Счётчики для подписей под вкладками. Если не переданы — подписи не показываются */
  tabCounts?: { ru: number; foreign: number };
};

/** Слайдер регионов: Российские / Иностранные. Стиль как в каталоге, без вкладки «Все». */
export function RegionSlider({ value, onChange, tabCounts }: RegionSliderProps) {
  const sliderRef = useRef<HTMLDivElement | null>(null);
  const ruRef = useRef<HTMLButtonElement | null>(null);
  const foreignRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    const updateSlider = () => {
      const el = value === "ru" ? ruRef.current : foreignRef.current;
      if (!el || !sliderRef.current) return;
      sliderRef.current.style.left = `${el.offsetLeft}px`;
      sliderRef.current.style.width = `${el.offsetWidth}px`;
    };
    updateSlider();
    requestAnimationFrame(updateSlider);
    const parent = ruRef.current?.parentElement ?? foreignRef.current?.parentElement;
    const ro = parent ? new ResizeObserver(updateSlider) : null;
    if (ro && parent) ro.observe(parent);
    return () => ro?.disconnect();
  }, [value]);

  return (
    <div className="flex lg:inline-flex w-full lg:w-auto relative rounded-[300px] bg-[#F1F1F2] p-1 cursor-pointer flex-nowrap">
      <div
        ref={sliderRef}
        className="absolute top-1 bottom-1 rounded-[300px] bg-white transition-all duration-200 ease-out"
      />
      <button
        type="button"
        onClick={() => onChange("ru")}
        ref={ruRef}
        className="relative z-10 flex-1 lg:flex-initial min-w-0 lg:min-w-[140px] px-3 lg:px-6 py-2 font-medium cursor-pointer text-center flex flex-col items-center gap-0.5"
      >
        <span className="text-[16px] leading-[18px]">Российские</span>
        {tabCounts != null && (
          <span className="text-[#666666] text-[13px] leading-[16px] lg:text-[14px]">
            {formatNumber(tabCounts.ru)}
          </span>
        )}
      </button>
      <button
        type="button"
        onClick={() => onChange("foreign")}
        ref={foreignRef}
        className="relative z-10 flex-1 lg:flex-initial min-w-0 lg:min-w-[140px] px-3 lg:px-6 py-2 font-medium cursor-pointer text-center flex flex-col items-center gap-0.5"
      >
        <span className="text-[16px] leading-[18px]">Иностранные</span>
        {tabCounts != null && (
          <span className="text-[#666666] text-[13px] leading-[16px] lg:text-[14px]">
            {formatNumber(tabCounts.foreign)}
          </span>
        )}
      </button>
    </div>
  );
}
