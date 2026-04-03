"use client";

import { useEffect, useState } from "react";
import Lottie from "lottie-react";
import { Button } from "./Button";
import { Header } from "./Header";

type Props = {
  title?: string;
  /** Ссылка для кнопки «Перейти в каталог» (например сохранённый return URL с каталога) */
  catalogHref?: string;
  hint?: string;
};

function Eyes404Row({ animationData }: { animationData: object | null }) {
  /** Размеры как у эмптистейта каталога: `w-24` / `lg:w-[168px]` для Lottie глаз */
  return (
    <div className="mb-6 flex items-center justify-center gap-1 sm:gap-1.5 lg:gap-2" aria-hidden>
      <span className="text-[72px] sm:text-[88px] lg:text-[128px] font-bold leading-none text-[#11111B]">
        4
      </span>
      <div className="inline-flex items-center justify-center shrink-0 w-24 h-24 sm:w-[120px] sm:h-[120px] lg:w-[168px] lg:h-[168px]">
        {animationData ? (
          <Lottie
            animationData={animationData}
            loop
            className="w-full h-full"
            style={{ width: "100%", height: "100%" }}
          />
        ) : (
          <div className="w-full h-full rounded-full bg-[#E4E4EA]" />
        )}
      </div>
      <span className="text-[72px] sm:text-[88px] lg:text-[128px] font-bold leading-none text-[#11111B]">
        4
      </span>
    </div>
  );
}

export function CoinMissingView({
  title = "Монета не найдена",
  catalogHref = "/catalog",
  hint = "Такой страницы больше нет или в адресе ошибка",
}: Props) {
  const [eyesAnimationData, setEyesAnimationData] = useState<object | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/animations/Eyes.json")
      .then((res) => res.json())
      .then((data) => {
        if (!cancelled) setEyesAnimationData(data);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="min-h-screen bg-white">
      <Header activePath="/catalog" />
      <main className="w-full px-4 sm:px-6 lg:px-20">
        <div className="max-w-md mx-auto flex flex-col items-center text-center pt-16 pb-24 sm:pt-24 sm:pb-32">
          <Eyes404Row animationData={eyesAnimationData} />
          {/* Кегль как у эмптистейтов каталога («Ожидается пополнение», «не найдены»): 24px / 18px */}
          <h1 className="text-black text-[24px] font-semibold mb-2">{title}</h1>
          <p className="text-[#666666] text-[18px] leading-[1.4] max-w-[360px] mb-8">{hint}</p>
          <div className="flex flex-row gap-3 w-full sm:w-auto sm:inline-flex items-center">
            <Button href={catalogHref} variant="primary" className="flex-1 sm:flex-initial">
              Перейти в каталог
            </Button>
            <Button href="/" variant="secondary" className="flex-1 sm:flex-initial">
              На главную
            </Button>
          </div>
        </div>
      </main>
    </div>
  );
}
