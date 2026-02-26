type MintCardProps = {
  id: string
  name: string
  country: string
  imageUrl: string
  href?: string
}

export function MintCard({ id, name, country, imageUrl, href }: MintCardProps) {
  const card = (
    <div className="w-full min-w-0 pt-4 pb-4 flex flex-col items-center gap-5 group">
      <div className="w-full h-[192px] md:h-[220px] xl:h-[296px] px-6 py-4 md:px-8 md:py-5 xl:px-10 xl:py-8 relative bg-[rgba(17,17,27,0.03)] rounded-2xl flex items-center justify-center transition-colors duration-200 group-hover:bg-[rgba(17,17,27,0.06)]">
        <img
          src={imageUrl}
          alt={name}
          className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[240px] h-[240px] object-contain max-h-[160px] md:max-h-[180px] xl:max-h-none"
        />
      </div>
      <div className="w-full flex items-start gap-3">
        <div className="flex-1 flex flex-col justify-center gap-1">
          <div className="text-black text-[16px] font-medium">
            {name}
          </div>
          <div className="text-[#656565] text-[14px] font-normal">
            {country}
          </div>
        </div>
      </div>
    </div>
  )

  if (href) {
    return (
      <a href={href} className="block group">
        {card}
      </a>
    )
  }

  return card
}

/** Скелетон карточки монетного двора (как в каталоге — анимация skeleton-pulse-opacity). */
export function MintCardSkeleton() {
  return (
    <div className="w-full min-w-0 pt-4 pb-4 flex flex-col items-center gap-5 skeleton-pulse-opacity" aria-hidden>
      <div className="w-full h-[192px] md:h-[220px] xl:h-[296px] rounded-2xl bg-[#E4E4EA]" />
      <div className="w-full flex items-start gap-3">
        <div className="flex-1 flex flex-col justify-center gap-1">
          <div className="h-4 w-[80%] rounded-[300px] bg-[#E4E4EA]" />
          <div className="h-4 w-[50%] rounded-[300px] bg-[#E4E4EA]" />
        </div>
      </div>
    </div>
  )
}

