type TabItem = {
  label: string
  href: string
  disabled?: boolean
}

type TabsProps = {
  items: TabItem[]
  activePath?: string
  className?: string
  linkClassName?: string
}

export function Tabs({ items, activePath = '', className = '', linkClassName = '' }: TabsProps) {
  return (
    <div className={className}>
      {items.map((item) => {
        const isActive = item.href === activePath && !item.disabled
        const isDisabled = item.disabled

        if (isDisabled) {
          return (
            <div
              key={item.href}
              className={`
                h-full flex items-center shrink-0 pt-[16px] pb-[23px] border-b-2 border-b-transparent
                cursor-not-allowed
                ${linkClassName}
              `.trim()}
            >
              <span className="text-[16px] font-medium text-[#11111B] opacity-10 whitespace-nowrap">
                {item.label}
              </span>
            </div>
          )
        }

        return (
          <a
            key={item.href}
            href={item.href}
            className={`
              h-full flex items-center shrink-0 pt-[16px] pb-[23px] border-b-2
              transition-colors duration-150
              ${isActive ? 'border-b-[#11111B]' : 'border-b-transparent hover:border-b-[#11111B]/50'}
              ${linkClassName}
            `.trim()}
          >
            <span
              className={`text-[16px] font-medium text-[#11111B] whitespace-nowrap ${isActive ? '' : 'opacity-50'}`}
            >
              {item.label}
            </span>
          </a>
        )
      })}
    </div>
  )
}
