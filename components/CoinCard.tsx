"use client";

import { useState, useRef, useEffect } from 'react'
import { IconPlus, IconCheck } from '@tabler/icons-react'
import { cleanCoinTitle } from '../lib/cleanTitle'

type CoinCardProps = {
  id: string
  title: string
  country: string
  year: number
  faceValue?: string
  approxPriceRub?: number
  metalLabel?: string
  imageUrl: string
  imageUrls?: string[]
  seriesName?: string
  mintShort?: string
  mintLogoUrl?: string
  href?: string
  inCollection?: boolean
  /** Квадратная/прямоугольная монета — не обрезаем по кругу */
  rectangular?: boolean
  onToggleCollection?: (id: string) => void
  /** Если false, показываем тултип «авторизуйтесь» и ведём на страницу входа */
  isAuthorized?: boolean
}

export function CoinCard(props: CoinCardProps) {
  const {
    id,
    title,
    country,
    year,
    faceValue,
    approxPriceRub,
    metalLabel,
    imageUrl,
    imageUrls,
    seriesName,
    mintShort,
    href,
    inCollection = false,
    onToggleCollection,
    isAuthorized = false,
    rectangular = false,
  } = props

  const images = imageUrls?.length ? imageUrls : [imageUrl]
  const [hoverImageIndex, setHoverImageIndex] = useState(0)
  const [justAdded, setJustAdded] = useState(false)
  const [justRemoved, setJustRemoved] = useState(false)
  const imageContainerRef = useRef<HTMLDivElement>(null)

  const handleImageMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (images.length <= 1) return
    const el = imageContainerRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    const x = e.clientX - rect.left
    const zone = (x / rect.width) * images.length
    const idx = Math.min(Math.max(0, Math.floor(zone)), images.length - 1)
    setHoverImageIndex(idx)
  }

  const handleImageMouseLeave = () => {
    setHoverImageIndex(0)
  }

  useEffect(() => {
    if (!justAdded) return
    const t = setTimeout(() => setJustAdded(false), 500)
    return () => clearTimeout(t)
  }, [justAdded])

  useEffect(() => {
    if (!justRemoved) return
    const t = setTimeout(() => setJustRemoved(false), 500)
    return () => clearTimeout(t)
  }, [justRemoved])

  // Страна · МД · Серия (для российских — короткое название монетного двора: ММД, ЛМД и т.д.)
  const subtitleParts = [
    country,
    country === "Россия" && mintShort ? mintShort.replace(/, /g, " и ") : null,
    seriesName,
  ].filter(Boolean) as string[]
  const subtitle = subtitleParts.join(" · ")

  const inner = (
    <div className="group w-full min-w-0 flex flex-col items-stretch">
      {/* Паддинги блока с монетой (px-12 pt-6 pb-8) — отключены, можно вернуть при необходимости */}
      <div className="w-full flex flex-col items-center">
        <div
          ref={imageContainerRef}
          className="w-full h-[14rem] sm:h-[16rem] lg:h-[18.5rem] relative flex items-center justify-center overflow-visible"
          onMouseMove={handleImageMouseMove}
          onMouseLeave={handleImageMouseLeave}
        >
          <div className={`w-full h-full flex items-center justify-center max-w-[17rem] max-h-[17rem] transition-transform duration-500 lg:group-hover:-translate-y-2 ${rectangular ? "rounded-2xl" : "rounded-full overflow-hidden"}`}>
            <img
              src={images[hoverImageIndex] ?? imageUrl}
              alt={cleanCoinTitle(title)}
              className="w-full h-full object-contain"
            />
          </div>
          {/* Кнопка «Добавить в коллекцию»: иконка видна только если монета в коллекции (галочка с анимацией) или при ховере карточки (плюс). На мобильных скрыта пока что */}
          <div className="absolute top-1 right-0 sm:top-2 sm:right-0 lg:top-[0.75rem] lg:right-4 pointer-events-none hidden lg:block">
          <div className={`pointer-events-auto relative group/btn ${isAuthorized && inCollection ? "opacity-100" : "opacity-0 lg:group-hover:opacity-100"} transition-opacity duration-200`}>
            {isAuthorized ? (
              <>
                <button
                  type="button"
                  onClick={(e) => {
                    e.preventDefault()
                    e.stopPropagation()
                    if (inCollection) setJustRemoved(true)
                    else setJustAdded(true)
                    onToggleCollection?.(id)
                  }}
                  className={`p-2 rounded-[300px] bg-transparent text-[#C0C0C0] hover:text-black cursor-pointer transition-colors duration-150 inline-flex items-center justify-center ${!inCollection ? "lg:group-hover:text-black" : ""}`}
                  aria-label={inCollection ? "В коллекции" : "Добавить в коллекцию"}
                >
                  {inCollection ? (
                    <span className={`inline-flex ${justAdded ? "animate-collection-added" : ""}`}>
                      <IconCheck size={24} stroke={2.5} />
                    </span>
                  ) : (
                    <span className={justRemoved ? "inline-flex animate-collection-added" : "inline-flex"}>
                      <IconPlus size={24} stroke={2} />
                    </span>
                  )}
                </button>
                <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-4 py-3 bg-[#11111B] text-white text-[14px] font-medium rounded-[300px] whitespace-nowrap opacity-0 pointer-events-none lg:group-hover/btn:opacity-100 transition-opacity duration-150 hidden lg:block">
                  {inCollection ? "В коллекции" : "Добавить в коллекцию"}
                  <span className="absolute top-full left-1/2 -translate-x-1/2 border-[6px] border-transparent border-t-[#11111B]" aria-hidden />
                </div>
              </>
            ) : (
              <>
                <span
                  className="p-2 rounded-[300px] bg-transparent text-black inline-flex cursor-default"
                  aria-label="Чтобы добавить монету в коллекцию, авторизуйтесь"
                >
                  <IconPlus size={24} stroke={2} />
                </span>
                <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-4 py-3 bg-[#11111B] text-white text-[14px] font-medium rounded-[300px] opacity-0 pointer-events-none lg:group-hover/btn:opacity-100 transition-opacity duration-150 text-center w-max hidden lg:block">
                  <span className="whitespace-nowrap">Чтобы добавить монету в коллекцию,</span><br /><span className="underline">авторизуйтесь</span>
                  <span className="absolute top-full left-1/2 -translate-x-1/2 border-[6px] border-transparent border-t-[#11111B]" aria-hidden />
                </div>
              </>
            )}
          </div>
        </div>
        </div>
        {/* Кружочки: количество картинок, выбранная — чёрная. Только на десктопе при 2+ картинках. Ближе к монете, подальше от текста */}
        {images.length > 1 && (
          <div className="hidden lg:flex items-center justify-center gap-1.5 mt-1 mb-2">
            {images.map((_, i) => (
              <span
                key={i}
                className={`w-1.5 h-1.5 rounded-full transition-colors duration-150 ${
                  i === hoverImageIndex ? 'bg-[#11111B]' : 'bg-[#E4E4EA]'
                }`}
                aria-hidden
              />
            ))}
          </div>
        )}
      </div>

      <div className="w-full flex items-start gap-[0.75rem] min-w-0">
        <div className="flex-1 min-w-0 flex flex-col justify-center gap-1">
          <h3 className="text-black text-[16px] font-medium line-clamp-3 sm:line-clamp-none break-words overflow-hidden">
            {cleanCoinTitle(title)}
          </h3>
          <p className="text-[#656565] text-[14px] font-normal break-words overflow-hidden line-clamp-3 sm:line-clamp-none">
            {subtitle}
          </p>
          {/* Цену временно скрываем, оставляем поле в типе для будущего использования */}
        </div>
      </div>
    </div>
  )

  if (href) {
    return (
      <a href={href} className="block">
        {inner}
      </a>
    )
  }

  return inner
}

export function CoinCardSkeleton() {
  return (
    <div className="w-full min-w-0 flex flex-col items-stretch skeleton-pulse-opacity" aria-hidden>
      {/* Структура как у CoinCard: контейнер с фиксированной высотой, внутри flex + max размеры, круг не вытягивается */}
      <div className="w-full flex flex-col items-center">
        <div className="w-full h-[14rem] sm:h-[16rem] lg:h-[18.5rem] relative flex items-center justify-center overflow-visible">
          <div className="w-full h-full flex items-center justify-center max-w-[17rem] max-h-[17rem]">
            {/* Размер только по ширине + aspect-ratio; max-h-full не даёт вылезать по высоте — круг = min(ширина, высота) контейнера */}
            <div className="rounded-full bg-[#E4E4EA] w-full max-h-full aspect-square min-h-0 max-w-[17rem] max-h-[17rem]" />
          </div>
        </div>
        {/* Плейсхолдер кружочков на десктопе — как в карточке */}
        <div className="hidden lg:flex items-center justify-center gap-1.5 mt-1 mb-2">
          <span className="w-1.5 h-1.5 rounded-full bg-[#E4E4EA]" aria-hidden />
          <span className="w-1.5 h-1.5 rounded-full bg-[#E4E4EA]" aria-hidden />
        </div>
      </div>

      {/* Текст: название + подзаголовок (страна · МД · серия), без логотипа */}
      <div className="w-full flex items-start gap-[0.75rem] min-w-0">
        <div className="flex-1 min-w-0 flex flex-col justify-center gap-1">
          <div className="h-4 w-[70%] rounded-[300px] bg-[#E4E4EA]" />
          <div className="h-4 w-[55%] rounded-[300px] bg-[#E4E4EA]" />
        </div>
      </div>
    </div>
  )
}

