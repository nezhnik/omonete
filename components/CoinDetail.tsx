"use client";

import { useState, useRef } from "react";
import Link from "next/link";
import { IconChevronLeft, IconChevronRight, IconCheck, IconPlus, IconShare3 } from "@tabler/icons-react";
import { cleanCoinTitle } from "../lib/cleanTitle";
import { formatQualityDisplay } from "../lib/qualityDisplay";
import { formatNumber, formatNumbersInString } from "../lib/formatNumber";

/** Данные монеты для страницы деталей (переиспользуемый тип) */
export type CoinDetailData = {
  id: string;
  title: string;
  seriesName?: string;
  imageUrl: string;
  imageUrls?: string[];
  /** Роли по индексу: obverse | reverse | box | certificate — для квадратного превью коробки/сертификата */
  imageUrlRoles?: string[];
  inCollection?: boolean;
  /** Монетный двор (полное наименование) */
  mintName: string;
  /** Короткое наименование МД (ММД, ЛМД) — для компактного отображения */
  mintShort?: string;
  mintCountry: string;
  mintLogoUrl?: string;
  /** Характеристики */
  year: number;
  faceValue: string;
  metal: string;
  metalCode?: string;
  metalColor?: string;
  quality?: string;
  mintage?: number;
  /** Тиражи с ЦБ «до X» — показываем как есть */
  mintageDisplay?: string;
  /** Чистого металла не менее, гр. — из БД weight_g */
  weightG?: string;
  /** Вес в унциях/кг (1 унция, 1/2 унции, 1 кг …) — из БД weight_oz */
  weightOz?: string;
  /** Форматированный вес для отображения (1/31,1 унции · 1 грамм и т.д.) */
  weightLabel?: string;
  purity?: string;
  diameterMm?: string;
  thicknessMm?: string;
  lengthMm?: string;
  widthMm?: string;
  /** Квадратная/прямоугольная монета — не обрезаем по кругу */
  rectangular?: boolean;
};

/** Элемент списка «Ещё монеты из этой серии». metalCodes из БД (как в характеристиках) — для биметалла [Au, Ag]. */
export type CoinSeriesItem = {
  id: string;
  title: string;
  seriesName?: string;
  faceValue: string;
  metalCode?: string;
  metalColor?: string;
  metalCodes?: string[];
  metalName?: string;
  weightG?: string;
  metalLabel?: string;
  imageUrl: string;
  rectangular?: boolean;
};

type CoinDetailProps = {
  coin: CoinDetailData;
  sameSeries?: CoinSeriesItem[];
  backHref?: string;
  backLabel?: string;
  /** Если false, показываем «авторизуйтесь» и ссылку на страницу входа */
  isAuthorized?: boolean;
  /** Вызов при нажатии «Добавить в коллекцию» / удалении из коллекции */
  onToggleCollection?: (coinId: string) => void;
};

function SpecRow({
  label,
  value,
  children,
  title,
}: {
  label: string;
  value?: string;
  children?: React.ReactNode;
  title?: string;
}) {
  return (
    <div className="flex items-center gap-2 min-h-[24px]">
      <span className="text-black text-[16px] font-normal shrink-0">{label}</span>
      <span className="flex-1 min-h-[24px] border-b border-[#E4E4EA] self-end mb-1" aria-hidden />
      {children ?? (
        <span className="text-[#666666] text-[16px] font-normal shrink-0" title={title}>
          {value}
        </span>
      )}
    </div>
  );
}

const SWIPE_MIN_DISTANCE = 50;
const SHOW_MONETIZATION_BLOCK = false;

const isPackagingRole = (role: string | undefined) => role === "box" || role === "certificate";

export function CoinDetail({ coin, sameSeries = [], backHref = "/catalog", backLabel = "Назад", isAuthorized = false, onToggleCollection }: CoinDetailProps) {
  // Всегда начинаем галерею с основной картинки imageUrl,
  // а затем показываем остальные уникальные изображения из imageUrls.
  const extraImages = coin.imageUrls?.length ? coin.imageUrls : [];
  const images = [coin.imageUrl, ...extraImages.filter((u) => u && u !== coin.imageUrl)];
  const rectangular = !!coin.rectangular;
  // Для основной картинки роли нет (undefined), далее — как в imageUrlRoles.
  const roles = coin.imageUrlRoles ? [undefined, ...coin.imageUrlRoles] : undefined;
  const isPackaging = (i: number) => isPackagingRole(roles?.[i]);
  const [selectedImage, setSelectedImage] = useState(0);
  const [copyToast, setCopyToast] = useState(false);
  const touchStartX = useRef<number | null>(null);

  const goPrev = () => setSelectedImage((i) => (i - 1 + images.length) % images.length);
  const goNext = () => setSelectedImage((i) => (i + 1) % images.length);

  const handleShare = async (e: React.MouseEvent | React.TouchEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const url = typeof window !== "undefined" ? window.location.href : "";
    const title = coin.title ? `${cleanCoinTitle(coin.title)} — О монете` : document.title;
    const isDesktop = typeof window !== "undefined" && window.innerWidth >= 1280;
    if (isDesktop) {
      doCopyFallback(url);
      return;
    }
    // На мобильных и планшетах — Web Share API (системное окно iOS/Android как на скрине)
    const shareData: ShareData = { title, url };
    if (typeof navigator !== "undefined" && navigator.share) {
      try {
        await navigator.share(shareData);
      } catch (err) {
        if ((err as Error).name !== "AbortError") doCopyFallback(url);
      }
    } else {
      doCopyFallback(url);
    }
  };
  function doCopyFallback(url: string) {
    if (typeof navigator === "undefined") return;
    const showToast = () => {
      setCopyToast(true);
      window.setTimeout(() => setCopyToast(false), 2500);
    };
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(url).then(showToast).catch(() => {
        legacyCopy(url) && showToast();
      });
    } else {
      legacyCopy(url) && showToast();
    }
  }
  function legacyCopy(url: string): boolean {
    if (typeof document === "undefined") return false;
    try {
      const ta = document.createElement("textarea");
      ta.value = url;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand("copy");
      document.body.removeChild(ta);
      return ok;
    } catch {
      return false;
    }
  }

  const handleTouchStart = (e: React.TouchEvent) => {
    touchStartX.current = e.targetTouches[0].clientX;
  };
  const handleTouchEnd = (e: React.TouchEvent) => {
    if (touchStartX.current == null || images.length <= 1) return;
    const endX = e.changedTouches[0].clientX;
    const diff = touchStartX.current - endX;
    if (Math.abs(diff) >= SWIPE_MIN_DISTANCE) {
      if (diff > 0) goNext();
      else goPrev();
    }
    touchStartX.current = null;
  };

  return (
    <div className="w-full px-4 sm:px-6 lg:px-20 pb-20 box-border">
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-8 lg:gap-10">
        {/* Левая половина (2 колонки): назад, галерея, дисклеймер. На десктопе фиксируем при скролле. */}
        <div className="flex flex-col gap-5 lg:col-span-2 lg:sticky lg:top-24 lg:self-start">
          <Link
            href={backHref}
            className="hidden lg:inline-flex items-center gap-2 text-black text-[16px] font-medium hover:opacity-80"
          >
            <span className="w-8 h-8 rounded-full bg-[#F1F1F2] flex items-center justify-center">
              <IconChevronLeft size={16} stroke={2} />
            </span>
            {backLabel}
          </Link>

          {/* На мобильном и планшете: кнопка слева, название и серия справа */}
          <div className="flex items-start gap-3 lg:hidden">
            <Link
              href={backHref}
              className="w-8 h-8 rounded-full bg-[#F1F1F2] flex items-center justify-center shrink-0 mt-0.5"
              aria-label={backLabel}
            >
              <IconChevronLeft size={16} stroke={2} className="text-black" />
            </Link>
            <div className="flex-1 min-w-0">
              <h1 className="text-black text-[28px] sm:text-[40px] font-semibold leading-tight">{cleanCoinTitle(coin.title)}</h1>
              {coin.seriesName && (
                <p className="text-[#656565] text-[16px] font-normal mt-0.5">{coin.seriesName}</p>
              )}
            </div>
          </div>

          <div className="flex flex-col gap-6">
            <div
              className={`group/coin relative w-full aspect-square max-h-[540px] lg:max-h-[736px] flex items-center justify-center bg-white overflow-hidden ${rectangular || isPackaging(selectedImage) ? "rounded-2xl" : "rounded-full"}`}
              onKeyDown={(e) => {
                if (images.length <= 1) return;
                if (e.key === "ArrowLeft") {
                  e.preventDefault();
                  goPrev();
                }
                if (e.key === "ArrowRight") {
                  e.preventDefault();
                  goNext();
                }
              }}
              onTouchStart={handleTouchStart}
              onTouchEnd={handleTouchEnd}
              tabIndex={images.length > 1 ? 0 : undefined}
              role={images.length > 1 ? "region" : undefined}
              aria-label={images.length > 1 ? "Галерея изображений монеты" : undefined}
            >
              {isPackaging(selectedImage) ? (
                <div className="w-full h-full p-4 sm:p-6 lg:p-8 flex items-center justify-center">
                  <img
                    src={images[selectedImage] ?? coin.imageUrl}
                    alt={cleanCoinTitle(coin.title)}
                    className="w-full h-full max-h-[540px] lg:max-h-[736px] pointer-events-none select-none object-contain"
                  />
                </div>
              ) : (
                <img
                  src={images[selectedImage] ?? coin.imageUrl}
                  alt={cleanCoinTitle(coin.title)}
                  className="w-full h-full max-h-[540px] lg:max-h-[736px] pointer-events-none select-none object-contain"
                />
              )}
              {images.length > 1 && (
                <>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      goPrev();
                    }}
                    className="absolute inset-y-0 left-[3%] my-auto w-8 h-8 p-0 rounded-full bg-[#F1F1F2] flex items-center justify-center opacity-0 group-hover/coin:opacity-100 hover:opacity-80 transition-opacity duration-200 focus:opacity-100 focus:outline-none cursor-pointer lg:block hidden"
                    aria-label="Предыдущее изображение"
                  >
                    <span className="w-4 h-4 flex items-center justify-center leading-none">
                      <IconChevronLeft size={16} stroke={2} className="text-black block shrink-0" />
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      goNext();
                    }}
                    className="absolute inset-y-0 right-[3%] my-auto w-8 h-8 p-0 rounded-full bg-[#F1F1F2] flex items-center justify-center opacity-0 group-hover/coin:opacity-100 hover:opacity-80 transition-opacity duration-200 focus:opacity-100 focus:outline-none cursor-pointer lg:block hidden"
                    aria-label="Следующее изображение"
                  >
                    <span className="w-4 h-4 flex items-center justify-center leading-none">
                      <IconChevronRight size={16} stroke={2} className="text-black block shrink-0" />
                    </span>
                  </button>
                </>
              )}
            </div>
            {images.length > 1 && (
              <div className="flex items-center justify-center gap-2">
                {images.map((url, i) => (
                  <button
                    key={i}
                    type="button"
                    onClick={() => setSelectedImage(i)}
                    className={`w-[88px] h-[88px] p-1.5 overflow-hidden flex items-center justify-center shrink-0 cursor-pointer lg:w-[144px] lg:h-[144px] lg:p-2 ${rectangular || isPackaging(i) ? "rounded-[0.5rem]" : "rounded-full"} ${
                      i === selectedImage ? "outline outline-2 outline-[#11111B] outline-offset-[-1px]" : "outline outline-1 outline-[#E4E4EA] outline-offset-[-1px]"
                    }`}
                  >
                    <img src={url} alt="" className={`w-[72px] h-[72px] lg:w-[128px] lg:h-[128px] ${isPackaging(i) ? "object-contain w-full h-full" : "object-contain"}`} />
                  </button>
                ))}
              </div>
            )}
            <p className="text-center text-[#666666] text-[16px] font-normal">
              {coin.mintCountry === "Россия"
                ? "Информация предоставлена в ознакомительных целях из открытых источников и сайта Банка России"
                : "Информация предоставлена в ознакомительных целях из открытых источников"}
            </p>

            {/* Кнопки «В коллекцию» и «Поделиться». В коллекцию — с текстом в кнопке. На мобильном — Web Share API или копирование */}
            <div className="lg:hidden flex items-center justify-end gap-3">
              {isAuthorized ? (
                <button
                  type="button"
                  onClick={() => onToggleCollection?.(coin.id)}
                  className="px-4 py-2 rounded-[300px] bg-[#F1F1F2] flex items-center justify-center gap-2 text-[#11111B] text-[14px] font-medium hover:bg-[#E4E4EA] transition-colors"
                  aria-label={coin.inCollection ? "Убрать из коллекции" : "Добавить в коллекцию"}
                >
                  {coin.inCollection ? <IconCheck size={22} stroke={2} /> : <IconPlus size={22} stroke={2} />}
                  <span>{coin.inCollection ? "Убрать из коллекции" : "Добавить в коллекцию"}</span>
                </button>
              ) : (
                <a
                  href="/login"
                  className="px-4 py-2 rounded-[300px] bg-[#F1F1F2] flex items-center justify-center gap-2 text-[#11111B] text-[14px] font-medium hover:bg-[#E4E4EA] transition-colors"
                  aria-label="Добавить в коллекцию"
                >
                  <IconPlus size={22} stroke={2} />
                  <span>Добавить в коллекцию</span>
                </a>
              )}
              <div className="relative group/btn inline-flex">
                <button
                  type="button"
                  onClick={handleShare}
                  onTouchEnd={(e) => { e.preventDefault(); handleShare(e as unknown as React.MouseEvent); }}
                  className="w-10 h-10 rounded-full bg-[#F1F1F2] flex items-center justify-center text-[#11111B] hover:bg-[#E4E4EA] transition-colors touch-manipulation"
                  aria-label="Поделиться"
                >
                  <IconShare3 size={22} stroke={2} />
                </button>
                <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-4 py-3 bg-[#11111B] text-white text-[14px] font-medium rounded-[300px] whitespace-nowrap opacity-0 pointer-events-none group-hover/btn:opacity-100 transition-opacity duration-150 hidden lg:block">
                  Поделиться монетой
                  <span className="absolute top-full left-1/2 -translate-x-1/2 border-[6px] border-transparent border-t-[#11111B]" aria-hidden />
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Правая половина (2 колонки): название, двор, характеристики, где купить, серия */}
        <div className="lg:col-span-2 min-w-0 flex flex-col gap-10">
          <div className="hidden lg:flex flex-col gap-2">
              <div className="flex flex-wrap items-center justify-between gap-4">
              <h1 className="text-black text-[28px] sm:text-[40px] font-semibold leading-tight">{cleanCoinTitle(coin.title)}</h1>
            </div>
            {coin.seriesName && (
              <p className="text-[#656565] text-[16px] font-normal">{coin.seriesName}</p>
            )}
            {/* Кнопки отдельно, справа */}
            <div className="flex justify-end gap-3">
              {isAuthorized ? (
                <button
                  type="button"
                  onClick={() => onToggleCollection?.(coin.id)}
                  className="px-4 py-2 rounded-[300px] bg-[#F1F1F2] flex items-center justify-center gap-2 text-[#11111B] text-[14px] font-medium hover:bg-[#E4E4EA] transition-colors cursor-pointer"
                  aria-label={coin.inCollection ? "Убрать из коллекции" : "Добавить в коллекцию"}
                >
                  {coin.inCollection ? <IconCheck size={22} stroke={2} /> : <IconPlus size={22} stroke={2} />}
                  <span>{coin.inCollection ? "Убрать из коллекции" : "Добавить в коллекцию"}</span>
                </button>
              ) : (
                <div className="relative group/btn inline-flex">
                  <a
                    href="/login"
                    className="px-4 py-2 rounded-[300px] bg-[#F1F1F2] flex items-center justify-center gap-2 text-[#11111B] text-[14px] font-medium hover:bg-[#E4E4EA] transition-colors cursor-pointer"
                    aria-label="Добавить в коллекцию"
                  >
                    <IconPlus size={22} stroke={2} />
                    <span>Добавить в коллекцию</span>
                  </a>
                  <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-4 py-3 bg-[#11111B] text-white text-[14px] font-medium rounded-[300px] opacity-0 pointer-events-none group-hover/btn:opacity-100 transition-opacity duration-150 text-center w-max">
                    <span className="whitespace-nowrap">Чтобы добавить в коллекцию,</span><br /><span className="underline">авторизуйтесь</span>
                    <span className="absolute top-full left-1/2 -translate-x-1/2 border-[6px] border-transparent border-t-[#11111B]" aria-hidden />
                  </div>
                </div>
              )}
              <div className="relative group/btn inline-flex">
                <button
                  type="button"
                  onClick={handleShare}
                  className="w-10 h-10 rounded-full bg-[#F1F1F2] flex items-center justify-center text-[#11111B] hover:bg-[#E4E4EA] transition-colors cursor-pointer"
                  aria-label="Поделиться"
                >
                  <IconShare3 size={22} stroke={2} />
                </button>
                <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-4 py-3 bg-[#11111B] text-white text-[14px] font-medium rounded-[300px] whitespace-nowrap opacity-0 pointer-events-none group-hover/btn:opacity-100 transition-opacity duration-150">
                  Поделиться монетой
                  <span className="absolute top-full left-1/2 -translate-x-1/2 border-[6px] border-transparent border-t-[#11111B]" aria-hidden />
                </div>
              </div>
            </div>
          </div>

          <section>
            <h2 className="text-black text-[24px] font-semibold pb-5">Характеристики</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-4">
              <div className="flex flex-col gap-4">
                {coin.mintCountry && <SpecRow label="Страна" value={coin.mintCountry} />}
                {(coin.mintName || coin.mintShort) && (
                  <SpecRow
                    label="Монетный двор"
                    value={(coin.mintShort ?? coin.mintName ?? "").replace(/, /g, " и ")}
                    title={coin.mintShort && coin.mintName ? coin.mintName : undefined}
                  />
                )}
                <SpecRow label="Год выпуска" value={String(coin.year)} />
                <SpecRow label="Номинал" value={formatNumbersInString(coin.faceValue)} />
                {coin.quality && <SpecRow label="Качество чеканки" value={formatQualityDisplay(coin.quality) || coin.quality} />}
                {(coin.mintageDisplay ?? coin.mintage != null) && (
                  <SpecRow
                    label="Тираж, шт."
                    value={coin.mintageDisplay ?? (coin.mintage != null ? formatNumber(coin.mintage) : "")}
                  />
                )}
              </div>
              <div className="flex flex-col gap-4">
                <SpecRow label="Металл">
                  <span className="inline-flex items-center gap-2">
                    {coin.metal && /золото|серебро/i.test(coin.metal) && /серебро.*золото|золото.*серебро/i.test(coin.metal) ? (
                      <>
                        <span
                          className="w-6 h-6 rounded-full flex items-center justify-center text-[12px] font-medium text-[#11111B] shrink-0"
                          style={{ background: "#FFD700" }}
                          title="Золото"
                        >
                          Au
                        </span>
                        <span
                          className="w-6 h-6 rounded-full flex items-center justify-center text-[12px] font-medium text-[#11111B] shrink-0"
                          style={{ background: "#C0C0C0" }}
                          title="Серебро"
                        >
                          Ag
                        </span>
                      </>
                    ) : (
                      coin.metalCode && (
                        <span
                          className="w-6 h-6 rounded-full flex items-center justify-center text-[12px] font-medium text-[#11111B] shrink-0"
                          style={{ background: coin.metalColor ?? "#D9D9D9" }}
                        >
                          {coin.metalCode}
                        </span>
                      )
                    )}
                    <span className="text-[#666666] text-[16px] font-normal">
                      {coin.metal && /золото|серебро/i.test(coin.metal) && /серебро.*золото|золото.*серебро/i.test(coin.metal)
                        ? "Золото / Серебро"
                        : coin.metal}
                    </span>
                  </span>
                </SpecRow>
                {coin.weightG && (
                  <SpecRow label="Чистого металла не менее, гр." value={formatNumbersInString(coin.weightG)} />
                )}
                {(coin.weightLabel ?? coin.weightOz) && (
                  <SpecRow label="Вес в унциях" value={coin.weightLabel ?? coin.weightOz} />
                )}
                {coin.purity && <SpecRow label="Проба" value={coin.purity} />}
                {coin.rectangular && (coin.lengthMm || coin.widthMm) ? (
                  <>
                    {coin.lengthMm && (
                      <SpecRow label="Длина, мм" value={formatNumbersInString(coin.lengthMm)} />
                    )}
                    {coin.widthMm && (
                      <SpecRow label="Ширина, мм" value={formatNumbersInString(coin.widthMm)} />
                    )}
                  </>
                ) : (
                  coin.diameterMm && (
                    <SpecRow label="Диаметр, мм" value={formatNumbersInString(coin.diameterMm)} />
                  )
                )}
                {coin.thicknessMm && (
                  <SpecRow label="Толщина, мм" value={formatNumbersInString(coin.thicknessMm)} />
                )}
              </div>
            </div>
          </section>

          {SHOW_MONETIZATION_BLOCK && (
            <section>
              <h2 className="text-black text-[24px] font-semibold pb-5">Где можно приобрести или заказать</h2>
              <div className="flex items-center gap-4 p-3 rounded-2xl">
                <img
                  src="/image/sales.gif"
                  alt=""
                  className="w-[88px] h-[88px] rounded-[6.86px] object-cover shrink-0"
                  onError={(e) => {
                    const el = e.currentTarget;
                    if (el.src.endsWith("sales.gif")) {
                      el.onerror = () => {
                        el.onerror = null;
                        el.src = "/image/coin-placeholder.png";
                      };
                      el.src = "/image/sales.webp";
                    } else {
                      el.onerror = null;
                      el.src = "/image/coin-placeholder.png";
                    }
                  }}
                />
                <div className="flex-1 min-w-0 flex flex-col gap-1">
                  <span className="text-black text-[18px] font-medium">Здесь могли быть ваша компания или канал</span>
                  <span className="text-[#666666] text-[16px]">
                    Хотите обсудить размещение?{" "}
                    <a href="https://t.me/nezhnik" target="_blank" rel="noopener noreferrer" className="text-[#0098E8] font-normal">
                      Напишите в телеграм
                    </a>
                  </span>
                </div>
              </div>
            </section>
          )}

          {sameSeries.length > 0 && (
            <section>
              <h2 className="text-black text-[24px] font-semibold pb-5">Ещё монеты из этой серии</h2>
              <div className="flex flex-col">
                {sameSeries.map((item) => (
                  <Link
                    key={item.id}
                    href={`/coins/${item.id}/`}
                    className="group flex items-center gap-3 sm:gap-4 lg:gap-[2.5rem] py-3 px-4 rounded-[300px] transition-colors [@media(hover:hover)]:hover:bg-black/5"
                  >
                    <div className="flex items-center min-w-0 gap-3 sm:gap-4 md:min-w-[336px] lg:min-w-[480px] max-w-[280px] sm:max-w-[480px]">
                      <img
                        src={item.imageUrl}
                        alt=""
                        className={`w-14 h-14 sm:w-[72px] sm:h-[72px] lg:w-[88px] lg:h-[88px] object-contain shrink-0 ${item.rectangular ? "rounded-[0.5rem]" : "rounded-full"}`}
                      />
                      <div className="min-w-0 flex flex-col gap-1">
                        <span className="text-black text-[16px] sm:text-[18px] font-medium line-clamp-2">{cleanCoinTitle(item.title)}</span>
                        {item.seriesName && (
                          <span className="text-[#666666] text-[14px] sm:text-[16px] font-normal line-clamp-1">{item.seriesName}</span>
                        )}
                      </div>
                    </div>
                    <div className="hidden md:flex flex-col items-start gap-1 shrink-0 min-w-[260px]">
                      <span className="text-black text-[18px] font-medium leading-tight min-h-[1.5em]">{item.faceValue}</span>
                      <div className="flex items-center gap-1.5 flex-wrap justify-start min-h-[1.5em]">
                        {item.metalCodes?.length === 2 ? (
                          <>
                            <span
                              className="w-5 h-5 rounded-full flex items-center justify-center text-[10px] sm:text-[12px] font-medium text-[#11111B] shrink-0"
                              style={{ background: "#FFD700" }}
                              title="Золото"
                            >
                              Au
                            </span>
                            <span
                              className="w-5 h-5 rounded-full flex items-center justify-center text-[10px] sm:text-[12px] font-medium text-[#11111B] shrink-0"
                              style={{ background: "#C0C0C0" }}
                              title="Серебро"
                            >
                              Ag
                            </span>
                          </>
                        ) : (
                          item.metalCode && (
                            <span
                              className="w-5 h-5 rounded-full flex items-center justify-center text-[10px] sm:text-[12px] font-medium text-[#11111B] shrink-0"
                              style={{ background: item.metalColor ?? "#D9D9D9" }}
                            >
                              {item.metalCode}
                            </span>
                          )
                        )}
                        {(item.metalName || item.metalLabel || item.weightG || item.metalCodes?.length === 2) && (
                          <span className="text-[#666666] text-[16px] font-normal">
                            {item.metalCodes?.length === 2
                              ? item.weightG
                                ? `Золото / Серебро · ${item.weightG}`
                                : "Золото / Серебро"
                              : item.metalName && item.weightG
                                ? `${item.metalName} · ${item.weightG}`
                                : item.weightG
                                  ? `${item.weightG} грамм`
                                  : item.metalLabel ?? item.metalName}
                          </span>
                        )}
                      </div>
                    </div>
                    <span className="w-6 h-6 flex items-center justify-center shrink-0 ml-auto mr-1 transition-transform duration-200 [@media(hover:hover)]:group-hover:translate-x-1">
                      <IconChevronRight size={24} stroke={2} className="text-[#666666] transition-colors [@media(hover:hover)]:group-hover:text-black" />
                    </span>
                  </Link>
                ))}
              </div>
            </section>
          )}
        </div>
      </div>

      {copyToast && (
        <div
          role="status"
          aria-live="polite"
          className="fixed left-1/2 -translate-x-1/2 top-6 z-50 px-4 py-3 bg-[#11111B] text-white text-[14px] font-medium rounded-[300px] whitespace-nowrap shadow-lg"
        >
          Ссылка скопирована
        </div>
      )}
    </div>
  );
}
