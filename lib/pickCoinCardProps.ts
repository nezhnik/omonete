/**
 * Пропсы для CoinCard без данных тиража: не передаём mintageNeedsResearch / mintageDisplay.
 * Иначе при «залипшей» старой сборке карточки снова появлялся второй абзац «Тираж не указан».
 */
export type CoinFieldsForCard = {
  id: string;
  title: string;
  country: string;
  year: number;
  faceValue?: string;
  approxPriceRub?: number;
  metalLabel?: string;
  imageUrl: string;
  imageUrls?: string[];
  seriesName?: string;
  mintShort?: string;
  mintLogoUrl?: string;
  rectangular?: boolean;
  imageUrlRoles?: string[];
};

export function pickCoinCardProps(coin: CoinFieldsForCard) {
  return {
    id: coin.id,
    title: coin.title,
    country: coin.country,
    year: coin.year,
    faceValue: coin.faceValue,
    approxPriceRub: coin.approxPriceRub,
    metalLabel: coin.metalLabel,
    imageUrl: coin.imageUrl,
    imageUrls: coin.imageUrls,
    seriesName: coin.seriesName,
    mintShort: coin.mintShort,
    mintLogoUrl: coin.mintLogoUrl,
    rectangular: coin.rectangular,
    imageUrlRoles: coin.imageUrlRoles,
  };
}
