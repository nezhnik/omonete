import type { CoinDetailData } from "../components/CoinDetail";
import { cleanCoinTitle } from "./cleanTitle";
import { formatPurityDisplay } from "./purityDisplay";
import {
  hasMeaningfulSpecYear,
  isMeaningfulDimensionOrWeight,
  isMeaningfulSpecString,
} from "./specValueVisibility";
import { formatQualityDisplay } from "./qualityDisplay";

/**
 * Видимый уникальный абзац на карточке монеты: больше индексируемого текста без правок в БД.
 */
export function buildCoinVisibleIntro(coin: CoinDetailData): string {
  const chunks: string[] = [];
  const title = cleanCoinTitle(coin.title);
  if (title) chunks.push(title.endsWith(".") ? title.slice(0, -1) : title);
  if (hasMeaningfulSpecYear(coin.year)) chunks.push(`год выпуска — ${coin.year}`);
  if (isMeaningfulSpecString(coin.mintCountry)) chunks.push(`страна эмитента: ${String(coin.mintCountry).trim()}`);
  const mint = (coin.mintShort || coin.mintName)?.replace(/, /g, " и ");
  if (isMeaningfulSpecString(mint)) chunks.push(`монетный двор: ${mint!.trim()}`);
  if (coin.seriesName?.trim()) chunks.push(`серия «${coin.seriesName.trim()}»`);
  if (isMeaningfulSpecString(coin.faceValue)) chunks.push(`номинал ${String(coin.faceValue).trim()}`);
  if (isMeaningfulSpecString(coin.metal)) chunks.push(`металл: ${coin.metal!.trim()}`);
  const purityForIntro = formatPurityDisplay(coin.purity);
  if (purityForIntro && isMeaningfulSpecString(purityForIntro)) chunks.push(`проба: ${purityForIntro}`);
  if (isMeaningfulSpecString(coin.quality)) {
    const qLine = formatQualityDisplay(coin.quality) || coin.quality!.trim();
    chunks.push(`качество чеканки: ${qLine}`);
  }
  if (isMeaningfulDimensionOrWeight(coin.weightOz)) chunks.push(`вес: ${coin.weightOz!.trim()}`);
  else if (isMeaningfulDimensionOrWeight(coin.weightG)) chunks.push(`чистого металла не менее ${coin.weightG!.trim()} г`);

  let out = chunks.join(". ") + ". Подробные характеристики и изображения — в каталоге Omonete.";
  if (out.length > 1200) out = `${out.slice(0, 1197)}…`;
  return out;
}
