import type { CoinDetailData } from "../components/CoinDetail";
import { cleanCoinTitle } from "./cleanTitle";
import { formatPurityDisplay } from "./purityDisplay";

/**
 * Видимый уникальный абзац на карточке монеты: больше индексируемого текста без правок в БД.
 */
export function buildCoinVisibleIntro(coin: CoinDetailData): string {
  const chunks: string[] = [];
  const title = cleanCoinTitle(coin.title);
  if (title) chunks.push(title.endsWith(".") ? title.slice(0, -1) : title);
  if (coin.year) chunks.push(`год выпуска — ${coin.year}`);
  if (coin.mintCountry?.trim()) chunks.push(`страна эмитента: ${coin.mintCountry.trim()}`);
  const mint = (coin.mintShort || coin.mintName)?.replace(/, /g, " и ");
  if (mint?.trim()) chunks.push(`монетный двор: ${mint.trim()}`);
  if (coin.seriesName?.trim()) chunks.push(`серия «${coin.seriesName.trim()}»`);
  const fv = coin.faceValue && String(coin.faceValue).trim();
  if (fv && fv !== "—") chunks.push(`номинал ${fv}`);
  if (coin.metal?.trim()) chunks.push(`металл: ${coin.metal.trim()}`);
  const purityForIntro = formatPurityDisplay(coin.purity);
  if (purityForIntro) chunks.push(`проба: ${purityForIntro}`);
  if (coin.quality?.trim()) chunks.push(`качество чеканки: ${coin.quality.trim()}`);
  if (coin.weightOz?.trim()) chunks.push(`вес: ${coin.weightOz.trim()}`);
  else if (coin.weightG?.trim()) chunks.push(`чистого металла не менее ${coin.weightG.trim()} г`);

  let out = chunks.join(". ") + ". Подробные характеристики и изображения — в каталоге Omonete.";
  if (out.length > 1200) out = `${out.slice(0, 1197)}…`;
  return out;
}
