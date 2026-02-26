"use client";

import { useState, useRef, useEffect } from "react";
import Link from "next/link";
import { IconArrowUp, IconChevronLeft, IconChevronRight } from "@tabler/icons-react";
import type { MintArticleData, MintForBlock } from "../lib/mint-articles";
import { nbspAfterPrepositions } from "../lib/nbspPrepositions";
import { MintCard } from "./MintCard";

const SWIPE_MIN_DISTANCE = 50;

type MintArticleProps = {
  article: MintArticleData;
  backHref?: string;
  backLabel?: string;
  /** Дворы для блока «Узнайте больше о других монетных дворах» (2 в ряд на планшете и десктопе). */
  otherMints?: MintForBlock[];
};

export function MintArticle({ article, backHref = "/", backLabel = "Назад", otherMints = [] }: MintArticleProps) {
  const images = article.galleryImages?.length ? article.galleryImages : [article.logoUrl];
  const [selectedImage, setSelectedImage] = useState(0);
  const [showScrollTop, setShowScrollTop] = useState(false);
  const touchStartX = useRef<number | null>(null);

  useEffect(() => {
    const onScroll = () => setShowScrollTop(typeof window !== "undefined" && window.scrollY > 500);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const goPrev = () => setSelectedImage((i) => (i - 1 + images.length) % images.length);
  const goNext = () => setSelectedImage((i) => (i + 1) % images.length);

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
      <div className="grid grid-cols-1 gap-8 lg:gap-10 max-w-[840px] mx-auto">
        {/* Блок назад + галерея (сверху на всех экранах) */}
        <div className="flex flex-col gap-5">
          <Link
            href={backHref}
            className="inline-flex items-center gap-2 text-black text-[16px] font-medium hover:opacity-80 w-fit"
          >
            <span className="w-8 h-8 rounded-full bg-[#F1F1F2] flex items-center justify-center">
              <IconChevronLeft size={16} stroke={2} />
            </span>
            {backLabel}
          </Link>

          <div className="flex flex-col gap-6">
            <div
              className="group/gallery relative w-full aspect-square max-h-[540px] flex items-center justify-center bg-[rgba(17,17,27,0.03)] rounded-2xl overflow-hidden"
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
              aria-label={images.length > 1 ? "Галерея изображений" : undefined}
            >
              <img
                src={images[selectedImage] ?? article.logoUrl}
                alt={article.name}
                className="w-full h-full max-h-[540px] object-contain pointer-events-none select-none p-6"
              />
              {images.length > 1 && (
                <>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      goPrev();
                    }}
                    className="absolute inset-y-0 left-[3%] my-auto w-8 h-8 p-0 rounded-full bg-[#F1F1F2] flex items-center justify-center opacity-0 group-hover/gallery:opacity-100 hover:opacity-80 transition-opacity duration-200 focus:opacity-100 focus:outline-none cursor-pointer hidden sm:block"
                    aria-label="Предыдущее изображение"
                  >
                    <IconChevronLeft size={16} stroke={2} className="text-black block shrink-0" />
                  </button>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      goNext();
                    }}
                    className="absolute inset-y-0 right-[3%] my-auto w-8 h-8 p-0 rounded-full bg-[#F1F1F2] flex items-center justify-center opacity-0 group-hover/gallery:opacity-100 hover:opacity-80 transition-opacity duration-200 focus:opacity-100 focus:outline-none cursor-pointer hidden sm:block"
                    aria-label="Следующее изображение"
                  >
                    <IconChevronRight size={16} stroke={2} className="text-black block shrink-0" />
                  </button>
                </>
              )}
            </div>
            {images.length > 1 && (
              <div className="flex items-center justify-center gap-2 flex-wrap">
                {images.map((url, i) => (
                  <button
                    key={i}
                    type="button"
                    onClick={() => setSelectedImage(i)}
                    className={`w-[88px] h-[88px] p-1.5 overflow-hidden flex items-center justify-center shrink-0 cursor-pointer sm:w-[120px] sm:h-[120px] sm:p-2 rounded-2xl ${
                      i === selectedImage ? "outline outline-2 outline-[#11111B] outline-offset-[-1px]" : "outline outline-1 outline-[#E4E4EA] outline-offset-[-1px]"
                    }`}
                  >
                    <img src={url} alt="" className="w-full h-full object-contain" />
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Заголовок, блоки статьи, факты */}
        <div className="flex flex-col gap-8">
          <div className="flex flex-col gap-2">
            <h1 className="text-black text-[2rem] md:text-[3rem] font-semibold leading-tight">
              {article.name}{article.shortName && article.shortName !== article.name ? ` (${article.shortName})` : ""}
            </h1>
          </div>

          {article.sections.map((section, idx) => (
            <section key={idx} className="flex flex-col gap-3">
              <h2 className="text-black text-[1.5rem] md:text-[1.75rem] font-semibold leading-tight">
                {section.title}
              </h2>
              <div className="flex flex-col gap-3 text-[#333333] text-[1.15rem] md:text-[1.25rem] leading-[1.6]">
                {section.content.split(/\n\n+/).map((p, i) => (
                  <p key={i}>{nbspAfterPrepositions(p.trim())}</p>
                ))}
              </div>
            </section>
          ))}

          {article.facts.length > 0 && (
            <section className="flex flex-col gap-4 pt-4">
              <h2 className="text-black text-[1.5rem] md:text-[1.75rem] font-semibold leading-tight">
                Интересные факты
              </h2>
              <ul className="flex flex-col gap-2 list-none pl-0">
                {article.facts.map((fact, i) => (
                  <li
                    key={i}
                    className="flex gap-2 text-[#333333] text-[1.15rem] md:text-[1.25rem] leading-[1.6] before:content-['•'] before:text-black before:font-bold before:shrink-0"
                  >
                    <span>{nbspAfterPrepositions(fact)}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {article.famousCoins && article.famousCoins.length > 0 && (
            <section className="flex flex-col gap-4 pt-4">
              <h2 className="text-black text-[1.5rem] md:text-[1.75rem] font-semibold leading-tight">
                Известные монеты и награды
              </h2>
              <ul className="flex flex-col gap-2 list-none pl-0">
                {article.famousCoins.map((entry, i) => (
                  <li
                    key={i}
                    className="flex gap-2 text-[#333333] text-[1.15rem] md:text-[1.25rem] leading-[1.6] before:content-['•'] before:text-black before:font-bold before:shrink-0"
                  >
                    <span>
                      <strong>{entry.title}</strong>. {nbspAfterPrepositions(entry.description)}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {otherMints.length > 0 && (
            <section className="flex flex-col gap-6 pt-4">
              <h2 className="text-black text-[22px] sm:text-[24px] font-semibold leading-tight">
                Узнайте больше о других монетных дворах
              </h2>
              <div className="grid grid-cols-2 gap-6 md:gap-x-6 md:gap-y-3">
                {otherMints.map((mint) => (
                  <div key={mint.id}>
                    <MintCard
                      id={mint.id}
                      name={mint.name}
                      country={mint.country}
                      imageUrl={mint.imageUrl}
                      href={`/mints/${mint.id}`}
                    />
                  </div>
                ))}
              </div>
            </section>
          )}

          <div className="flex flex-col gap-1 mt-6">
            <p className="text-[#666666] text-[14px] font-normal">
              Вся информация предоставлена в ознакомительных целях из открытых источников.
            </p>
            <p className="text-[#666666] text-[14px] font-normal">
              {article.sourcesLine ?? "Источники: Википедия и открытые источники."}
            </p>
          </div>
        </div>
      </div>

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
