"use client";

import { useEffect, useState } from "react";
import { IconArrowUp } from "@tabler/icons-react";
import { Header } from "../../components/Header";
import { MintCard, MintCardSkeleton } from "../../components/MintCard";
import { nbspAfterPrepositions } from "../../lib/nbspPrepositions";

const MINT_PLACEHOLDER = "/image/coin-placeholder.svg";

const foreignMints = [
  { id: "us-mint", name: "Монетный двор США", country: "США", imageUrl: "/image/Mints/us-mint.webp" },
  { id: "royal-mint", name: "Королевский монетный двор Великобритании", country: "Великобритания", imageUrl: "/image/Mints/royal-mint.webp" },
  { id: "austrian-mint", name: "Австрийский монетный двор", country: "Австрия", imageUrl: "/image/Mints/austrian-mint.webp" },
  { id: "south-african-mint", name: "Южноафриканский монетный двор", country: "ЮАР", imageUrl: "/image/Mints/south-african-mint.webp" },
  { id: "japan-mint", name: "Монетный двор Японии", country: "Япония", imageUrl: "/image/Mints/japan-mint.webp" },
  { id: "komsco", name: "Корпорация чеканки и печати Кореи", country: "Южная Корея", imageUrl: "/image/Mints/komsco.webp" },
  { id: "monnaie-de-paris", name: "Монетный двор Парижа", country: "Франция", imageUrl: "/image/Mints/monnaie-de-paris.webp" },
  { id: "casa-de-moneda-mexico", name: "Монетный двор Мексики", country: "Мексика", imageUrl: "/image/Mints/casa-de-moneda-mexico.webp" },
  { id: "china-mint", name: "Корпорация печати и чеканки Китая", country: "Китай", imageUrl: "/image/Mints/china-mint.webp" },
  { id: "fnmt-spain", name: "Королевский монетный двор Испании", country: "Испания", imageUrl: "/image/Mints/fnmt-spain.webp" },
  { id: "ipzs-italy", name: "Государственный полиграфический институт и монетный двор Италии", country: "Италия", imageUrl: "/image/Mints/ipzs-italy.webp" },
  { id: "india-government-mint", name: "Монетные дворы Индии", country: "Индия", imageUrl: "/image/Mints/india-mint.webp" },
  { id: "royal-dutch-mint", name: "Королевский монетный двор Нидерландов", country: "Нидерланды", imageUrl: "/image/Mints/royal-dutch-mint.webp" },
  { id: "swissmint", name: "Федеральный монетный двор Швейцарии", country: "Швейцария", imageUrl: "/image/Mints/swissmint.webp" },
  { id: "perth-mint", name: "The Perth Mint", country: "Австралия", imageUrl: "/image/Mints/perth-mint.webp" },
  { id: "royal-australian-mint", name: "Royal Australian Mint", country: "Австралия", imageUrl: "/image/Mints/royal-australian-mint.webp" },
  { id: "germania-mint", name: "Germania Mint", country: "Германия", imageUrl: "/image/Mints/germania-mint.webp" },
  { id: "polska-mint", name: "Mint of Poland", country: "Польша", imageUrl: "/image/Mints/polska-mint.webp" },
  { id: "canadian-mint", name: "Royal Canadian Mint", country: "Канада", imageUrl: "/image/Mints/canadian-mint.webp" },
];

type MintItem = { id: string; name: string; country: string; imageUrl: string };

/** Как в каталоге: скелетоны не менее 1 с, затем появление карточек с анимацией. */
const SKELETON_DURATION_MS = 1000;
const SKELETON_COUNT_MOBILE = 6;
const SKELETON_COUNT_TABLET = 9;
const SKELETON_COUNT_DESKTOP = 15;

export default function MintsPage() {
  const [mints, setMints] = useState<MintItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [showSkeletons, setShowSkeletons] = useState(true);
  const [showScrollTop, setShowScrollTop] = useState(false);

  useEffect(() => {
    setLoading(true);
    fetch("/data/mints.json")
      .then((res) => (res.ok ? res.json() : Promise.reject()))
      .then((data: { mints?: { id?: string; name: string; slug?: string; logo_url?: string | null; country?: string }[] }) => {
        const list = data.mints ?? [];
        const ru = list.map((m) => ({
          id: m.slug ?? m.id ?? "",
          name: m.name,
          country: m.country ?? "Россия",
          imageUrl: m.logo_url ?? MINT_PLACEHOLDER,
        })).filter((m) => m.id);
        setMints(ru.length > 0 ? [...ru, ...foreignMints] : foreignMints);
      })
      .catch(() => setMints(foreignMints))
      .finally(() => setLoading(false));
  }, []);

  // Скелетоны не менее 1 с при первой загрузке (как в каталоге)
  useEffect(() => {
    const t = setTimeout(() => setShowSkeletons(false), SKELETON_DURATION_MS);
    return () => clearTimeout(t);
  }, []);

  // Кнопка «Наверх» при скролле (как в каталоге)
  useEffect(() => {
    const onScroll = () => setShowScrollTop(typeof window !== "undefined" && window.scrollY > 500);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const showSkeletonGrid = loading || showSkeletons;

  return (
    <div className="min-h-screen bg-white">
      <Header activePath="/mints" />

      <main className="w-full px-4 sm:px-6 lg:px-20 pt-6 pb-20">
        <h1 className="text-black text-[28px] sm:text-[36px] font-semibold leading-tight mb-2">
          Монетные дворы
        </h1>
        <p className="text-[#656565] text-[16px] font-normal mb-8 max-w-[640px] lg:max-w-[720px]">
          {nbspAfterPrepositions(
            "Познакомьтесь с историей и интересными фактами: от легендарных мастерских прошлого до современного производства памятных и инвестиционных монет"
          )}
        </p>

        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-3 xl:grid-cols-5 gap-6 md:gap-x-6 md:gap-y-3 lg:gap-x-6 lg:gap-y-3 xl:gap-6">
          {showSkeletonGrid
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
                  <MintCardSkeleton />
                </div>
              ))
            : mints.map((mint, index) => (
                <div
                  key={mint.id}
                  style={{
                    animation: "catalog-card-enter 0.3s ease forwards",
                    animationDelay: `${index * 0.05}s`,
                    opacity: 0,
                  }}
                >
                  <MintCard {...mint} href={`/mints/${mint.id}`} />
                </div>
              ))}
        </div>
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
