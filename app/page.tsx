"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Lottie from "lottie-react";
import { Header } from "../components/Header";
import { CoinCard } from "../components/CoinCard";
import { MintCard } from "../components/MintCard";
import { Button } from "../components/Button";
import { RegionSlider } from "../components/RegionSlider";
import { useAuth } from "../components/AuthProvider";

const HERO_COIN_INTERVAL_MS = 2500;

/** Фиксированный порядок монет для блока «Российские»: мобильный 4, планшет 9 (3 кол.), десктоп 10 (5 кол.) */
const RUSSIAN_FEATURED_IDS = ["2838", "3699", "2518", "3395", "3293", "3292", "3294", "2840", "3940", "3119"];

type DemoCoin = {
  id: string;
  title: string;
  country: string;
  year: number;
  faceValue?: string;
  imageUrl: string;
  imageUrls?: string[];
  seriesName?: string;
  mintShort?: string;
  rectangular?: boolean;
};

/** Российские дворы подгружаются из /data/mints.json (с логотипами); зарубежные — фиксированный список */
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

const MINT_PLACEHOLDER = "/image/coin-placeholder.svg";

export default function HomePage() {
  const { isAuthorized, inCollection, addToCollection, removeFromCollection } = useAuth();
  const handleToggleCollection = useCallback((id: string) => {
    if (inCollection(id)) removeFromCollection(id);
    else addToCollection(id);
  }, [inCollection, addToCollection, removeFromCollection]);

  const [region, setRegion] = useState<"ru" | "foreign">("ru");
  const [heroCoinIndex, setHeroCoinIndex] = useState(0);
  const [allCoins, setAllCoins] = useState<DemoCoin[]>([]);
  const [homeMints, setHomeMints] = useState<{ id: string; name: string; country: string; imageUrl: string }[]>(foreignMints);
  const [starAnimationData, setStarAnimationData] = useState<object | null>(null);

  useEffect(() => {
    fetch("/data/mints.json")
      .then((res) => res.ok ? res.json() : Promise.reject())
      .then((data: { mints?: { id?: string; name: string; slug?: string; logo_url?: string | null; country?: string }[] }) => {
        const list = data.mints ?? [];
        const ru = list.map((m) => ({
          id: m.slug ?? m.id ?? "",
          name: m.name,
          country: m.country ?? "Россия",
          imageUrl: m.logo_url ?? MINT_PLACEHOLDER,
        })).filter((m) => m.id);
        setHomeMints(ru.length > 0 ? [...ru, ...foreignMints] : foreignMints);
      })
      .catch(() => setHomeMints(foreignMints));
  }, []);

  useEffect(() => {
    import("../lib/fetchCoins").then(({ fetchCoinsList }) =>
      fetchCoinsList()
        .then((data) => setAllCoins((data.coins ?? []) as DemoCoin[]))
        .catch(() => setAllCoins([]))
    );
  }, []);

  const ruCoins = allCoins.filter((c) => c.country === "Россия");
  const foreignCoins = allCoins.filter((c) => c.country !== "Россия");
  const coinsById = useMemo(() => new Map(allCoins.map((c) => [c.id, c])), [allCoins]);
  /** Для анимации героя: случайные монеты из каталога (с картинкой), до 100 шт. Без fallback — только каталог. */
  const heroCoinImages = useMemo(() => {
    const withImage = allCoins.filter((c) => c.imageUrl);
    if (withImage.length === 0) return [];
    const shuffled = [...withImage];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    return shuffled.slice(0, 100).map((c) => ({ imageUrl: c.imageUrl!, rectangular: !!c.rectangular }));
  }, [allCoins]);

  useEffect(() => {
    if (heroCoinImages.length === 0) return;
    const n = heroCoinImages.length;
    const t = setInterval(() => {
      setHeroCoinIndex((i) => (i + 1) % n);
    }, HERO_COIN_INTERVAL_MS);
    return () => clearInterval(t);
  }, [heroCoinImages]);

  useEffect(() => {
    fetch("/animations/DizzyStar.json")
      .then((res) => res.json())
      .then(setStarAnimationData)
      .catch(() => {});
  }, []);

  const featuredCoins =
    region === "ru"
      ? (RUSSIAN_FEATURED_IDS.map((id) => coinsById.get(id)).filter(Boolean) as DemoCoin[])
      : foreignCoins.slice(0, 5);
  /** Мобильный 4, планшет (sm–lg) 9, десктоп (xl) 10 — видимость через классы ниже */
  const tabCounts = { ru: ruCoins.length, foreign: foreignCoins.length };
  const n = heroCoinImages.length;
  const step = heroCoinIndex;
  let farLeftIndex = 0;
  let leftIndex = n > 0 ? (step * 3) % n : 0;
  let centerIndex = n > 0 ? (step * 3 + 1) % n : 0;
  let rightIndex = n > 0 ? (step * 3 + 2) % n : 0;
  let farRightIndex = 0;
  if (n >= 5) {
    farLeftIndex = (step * 5) % n;
    leftIndex = (step * 5 + 1) % n;
    centerIndex = (step * 5 + 2) % n;
    rightIndex = (step * 5 + 3) % n;
    farRightIndex = (step * 5 + 4) % n;
  } else if (n >= 3) {
    if (leftIndex === centerIndex) centerIndex = (leftIndex + 1) % n;
    while (rightIndex === leftIndex || rightIndex === centerIndex) rightIndex = (rightIndex + 1) % n;
  }
  const showThreeCoins = n >= 3;
  const showFiveCoins = n >= 5;

  return (
    <div className="min-h-screen bg-white overflow-x-hidden">
      <Header activePath="/" />

      <main className="w-full px-4 sm:px-6 lg:px-20 overflow-x-hidden">
        <section className="mt-0 lg:mt-12">
          <div className="flex flex-col items-center gap-6 md:gap-10">
            <div className="hero-coins-wrap flex flex-row items-end justify-center gap-2 md:gap-4 lg:gap-6">
              {heroCoinImages.length === 0 ? (
                <>
                  {/* Скелетон: 5 на десктопе, 3 на планшете, 1 на мобильном — те же позиции что и монеты */}
                  <div className="hidden lg:block lg:w-[calc(260/560*var(--hero-center))] lg:h-[calc(260/560*var(--hero-center))] w-[260px] h-[260px] flex-shrink-0 rounded-[300px] bg-[#E4E4EA]" aria-hidden />
                  <div className="hidden md:block w-[320px] h-[320px] lg:w-[calc(360/560*var(--hero-center))] lg:h-[calc(360/560*var(--hero-center))] flex-shrink-0 rounded-[300px] bg-[#E4E4EA]" aria-hidden />
                  <div className="relative w-[312px] h-[339px] md:w-[480px] md:h-[516px] lg:w-[var(--hero-center)] lg:h-[calc(596/560*var(--hero-center))] flex items-center justify-center">
                    <div className="absolute left-0 top-[27px] md:top-[2.25rem] w-[312px] h-[312px] md:w-[480px] md:h-[480px] lg:w-[var(--hero-center)] lg:h-[var(--hero-center)] rounded-[300px] bg-[#E4E4EA]" aria-hidden />
                  </div>
                  <div className="hidden md:block w-[320px] h-[320px] lg:w-[calc(360/560*var(--hero-center))] lg:h-[calc(360/560*var(--hero-center))] flex-shrink-0 rounded-[300px] bg-[#E4E4EA]" aria-hidden />
                  <div className="hidden lg:block lg:w-[calc(260/560*var(--hero-center))] lg:h-[calc(260/560*var(--hero-center))] w-[260px] h-[260px] flex-shrink-0 rounded-[300px] bg-[#E4E4EA]" aria-hidden />
                </>
              ) : (
                <>
                  {showFiveCoins && (
                    <div className="hidden lg:block relative w-[260px] h-[260px] lg:w-[calc(260/560*var(--hero-center))] lg:h-[calc(260/560*var(--hero-center))] flex-shrink-0">
                      {heroCoinImages.map((item, i) => (
                        <img
                          key={item.imageUrl + i}
                          src={item.imageUrl}
                          alt=""
                          className={`absolute inset-0 w-full h-full object-contain object-bottom transition-opacity duration-700 ${item.rectangular ? "rounded-2xl" : "rounded-[300px]"}`}
                          style={{ opacity: i === farLeftIndex ? 1 : 0 }}
                          aria-hidden={i !== farLeftIndex}
                        />
                      ))}
                    </div>
                  )}
                  {showThreeCoins && (
                    <div className="relative w-[240px] h-[240px] lg:w-[calc(360/560*var(--hero-center))] lg:h-[calc(360/560*var(--hero-center))] flex-shrink-0">
                      {heroCoinImages.map((item, i) => (
                        <img
                          key={item.imageUrl + i}
                          src={item.imageUrl}
                          alt=""
                          className={`absolute inset-0 w-full h-full object-contain object-bottom transition-opacity duration-700 ${item.rectangular ? "rounded-2xl" : "rounded-[300px]"}`}
                          style={{ opacity: i === leftIndex ? 1 : 0 }}
                          aria-hidden={i !== leftIndex}
                        />
                      ))}
                    </div>
                  )}
                  <div className="relative w-[312px] h-[339px] md:w-[480px] md:h-[516px] lg:w-[var(--hero-center)] lg:h-[calc(596/560*var(--hero-center))] flex items-center justify-center">
                    {heroCoinImages.map((item, i) => (
                      <img
                        key={item.imageUrl + i}
                        src={item.imageUrl}
                        alt=""
                        className={`absolute left-0 top-[27px] md:top-[2.25rem] w-[312px] h-[312px] md:w-[480px] md:h-[480px] lg:w-[var(--hero-center)] lg:h-[var(--hero-center)] object-contain transition-opacity duration-700 ${item.rectangular ? "rounded-2xl" : "rounded-[300px]"}`}
                        style={{ opacity: centerIndex === i ? 1 : 0 }}
                        aria-hidden={centerIndex !== i}
                      />
                    ))}
                  </div>
                  {showThreeCoins && (
                    <div className="relative w-[240px] h-[240px] lg:w-[calc(360/560*var(--hero-center))] lg:h-[calc(360/560*var(--hero-center))] flex-shrink-0">
                      {heroCoinImages.map((item, i) => (
                        <img
                          key={item.imageUrl + i}
                          src={item.imageUrl}
                          alt=""
                          className={`absolute inset-0 w-full h-full object-contain object-bottom transition-opacity duration-700 ${item.rectangular ? "rounded-2xl" : "rounded-[300px]"}`}
                          style={{ opacity: i === rightIndex ? 1 : 0 }}
                          aria-hidden={i !== rightIndex}
                        />
                      ))}
                    </div>
                  )}
                  {showFiveCoins && (
                    <div className="hidden lg:block relative w-[260px] h-[260px] lg:w-[calc(260/560*var(--hero-center))] lg:h-[calc(260/560*var(--hero-center))] flex-shrink-0">
                      {heroCoinImages.map((item, i) => (
                        <img
                          key={item.imageUrl + i}
                          src={item.imageUrl}
                          alt=""
                          className={`absolute inset-0 w-full h-full object-contain object-bottom transition-opacity duration-700 ${item.rectangular ? "rounded-2xl" : "rounded-[300px]"}`}
                          style={{ opacity: i === farRightIndex ? 1 : 0 }}
                          aria-hidden={i !== farRightIndex}
                        />
                      ))}
                    </div>
                  )}
                </>
              )}
            </div>

            <div className="w-full max-w-[1128px] flex flex-col items-center gap-6 md:gap-10">
              <div className="w-full flex flex-col items-center gap-4 sm:gap-5">
                <h1 className="hero-title text-center text-black font-semibold tracking-normal text-3xl sm:text-5xl lg:leading-[1.15]">
                  Исследуйте мир нумизматики и&nbsp;управляйте своей коллекцией
                </h1>
                <p className="hero-subtitle w-full max-w-[616px] lg:max-w-[680px] text-center text-black text-[20px] leading-[1.4]">
                  Каталог всех монет России и мира из благородных металлов. Обновляется постоянно
                </p>
              </div>

              <div className="flex flex-row gap-3 w-full sm:w-auto sm:inline-flex items-center">
                <Button href="/login" variant="primary" className="flex-1 sm:flex-initial">
                  Присоединиться
                </Button>
                <Button href="/catalog" variant="secondary" className="flex-1 sm:flex-initial">
                  В каталог
                </Button>
              </div>
            </div>
          </div>
        </section>

        <section className="mt-[120px] lg:mt-[15rem]">
          <div className="flex flex-col items-center gap-6">
            <h2 className="w-full max-w-[616px] lg:max-w-[680px] text-center text-black font-semibold text-[28px] leading-tight sm:text-[40px] lg:text-[44px]">
              Найдите и&nbsp;добавьте монеты в&nbsp;коллекцию за&nbsp;секунды
            </h2>

            <RegionSlider value={region} onChange={setRegion} tabCounts={tabCounts} />

            {region === "foreign" && foreignCoins.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 pb-8 text-center">
                <div className="w-[168px] h-[168px] mb-6 flex items-center justify-center">
                  {starAnimationData ? (
                    <Lottie animationData={starAnimationData} loop style={{ width: 168, height: 168 }} />
                  ) : (
                    <div className="w-full h-full rounded-full bg-[#E4E4EA]" aria-hidden />
                  )}
                </div>
                <h3 className="text-black text-[24px] font-semibold mb-2">Ожидается пополнение</h3>
                <p className="text-[#666666] text-[18px] leading-[1.4] max-w-[360px]">
                  Скоро здесь появятся иностранные монеты
                </p>
              </div>
            ) : (
              <>
                <div className="w-full grid grid-cols-2 md:grid-cols-3 lg:grid-cols-3 xl:grid-cols-5 gap-6 md:gap-x-6 md:gap-y-3 lg:gap-x-6 lg:gap-y-3 xl:gap-6 pt-2">
                  {featuredCoins.map((coin, i) => (
                    <div
                      key={coin.id}
                      className={
                        i < 4 ? "" : i < 9 ? "hidden sm:block" : "hidden xl:block"
                      }
                    >
                      <CoinCard
                      {...coin}
                      href={`/coins/${coin.id}/`}
                      isAuthorized={isAuthorized}
                      inCollection={inCollection(coin.id)}
                      onToggleCollection={handleToggleCollection}
                    />
                    </div>
                  ))}
                </div>
                <Button href="/catalog" variant="secondary" className="w-full sm:w-auto">
                  Посмотреть все
                </Button>
              </>
            )}
          </div>
        </section>

        <section id="mints" className="mt-[120px] lg:mt-[15rem] pb-24">
          <div className="flex flex-col items-center gap-6">
            <h2 className="w-full max-w-[616px] lg:max-w-[680px] text-center text-black font-semibold text-[28px] leading-tight sm:text-[40px] lg:text-[44px]">
              Узнайте больше про&nbsp;монетные дворы
            </h2>

            <div className="w-full grid grid-cols-2 md:grid-cols-3 lg:grid-cols-3 xl:grid-cols-5 gap-6 md:gap-x-6 md:gap-y-3 lg:gap-x-6 lg:gap-y-3 xl:gap-6">
              {homeMints.slice(0, 10).map((mint, i) => (
                <div
                  key={mint.id}
                  className={i < 4 ? "" : i < 9 ? "hidden md:block" : "hidden xl:block"}
                >
                  <MintCard {...mint} href={`/mints/${mint.id}`} />
                </div>
              ))}
            </div>

            <Button href="/mints" variant="secondary" className="w-full sm:w-auto">
              Посмотреть все
            </Button>
          </div>
        </section>

        <footer className="w-full py-10 mt-8 border-t border-[#E4E4EA] px-4 sm:pl-0 sm:pr-6 lg:pl-0 lg:pr-20">
          <div className="flex flex-col gap-6 text-[#666666] text-[16px] max-w-[800px]">
            <nav className="flex flex-wrap items-center justify-start gap-4 sm:gap-6" aria-label="Навигация по сайту">
              <a href="/" className="text-black hover:opacity-80 transition-opacity" title="Главная страница omonete.ru">Главная</a>
              <a href="/catalog" className="text-black hover:opacity-80 transition-opacity" title="Каталог монет России и мира">Каталог монет</a>
              <a href="/mints" className="text-black hover:opacity-80 transition-opacity" title="Монетные дворы России и мира — статьи и история">Монетные дворы</a>
              <a href="/portfolio" className="text-black hover:opacity-80 transition-opacity" title="Моя коллекция монет">Портфолио</a>
              <a href="/login" className="text-black hover:opacity-80 transition-opacity" title="Вход в личный кабинет">Вход</a>
            </nav>
            <p className="text-left text-[15px] leading-[1.5]">
              Нумизматика и коллекционирование: каталог памятных и инвестиционных монет России и мира, статьи о монетных дворах, ведение коллекции.
            </p>
            <div className="flex flex-col gap-4 text-[14px]">
              <p className="text-left">
                Вопросы и предложения:{" "}
                <a href="https://t.me/nezhnik" target="_blank" rel="noopener noreferrer" className="text-[#0098E8] hover:underline">
                  Telegram
                </a>
              </p>
              <p className="text-left">
                Информация предоставлена в ознакомительных целях из открытых источников и сайта{" "}
                <a href="https://www.cbr.ru" target="_blank" rel="noopener noreferrer" className="text-[#0098E8] hover:underline">
                  Банка России
                </a>
              </p>
            </div>
            <p className="text-left text-[13px] text-[#999999]">
              © {new Date().getFullYear()} omonete.ru
            </p>
          </div>
        </footer>
      </main>
    </div>
  );
}
