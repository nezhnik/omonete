/**
 * Цена меди: парсинг с Elec.ru (LME в USD/т) + курс ЦБ → руб/г.
 * Бесплатно, без ключей. Хрупко: при смене вёрстки/текста на сайте парсер может сломаться.
 * Формула: руб/г = (USD/тонна / 1_000_000) × USD_RUB
 *
 * Запуск: node scripts/fetch-copper-price-elec.js
 */
const ELEC_COPPER_URL = "https://www.elec.ru/lme/copper/";
const CBR_JSON = "https://www.cbr-xml-daily.ru/daily_json.js";

async function getUsdRubToday() {
  const res = await fetch(CBR_JSON);
  if (!res.ok) throw new Error("CBR: " + res.status);
  const data = await res.json();
  const usd = data?.Valute?.USD;
  if (!usd || usd.Value == null) throw new Error("CBR: нет курса USD");
  return Number(usd.Value);
}

/** Парсит из HTML текст вида "сегодня составляет: 13343,5 US$ за тонну". */
function parseUsdPerTonneFromHtml(html) {
  const re = /сегодня\s+составляет:\s*([\d\s,]+)\s*US\s*\$?\s*за\s+тонну/i;
  const m = html.match(re);
  if (!m || !m[1]) throw new Error("Elec.ru: не найдена цена в тексте страницы");
  const numStr = m[1].replace(/\s/g, "").replace(",", ".");
  const value = parseFloat(numStr);
  if (Number.isNaN(value) || value <= 0) throw new Error("Elec.ru: некорректное число " + m[1]);
  return value;
}

async function main() {
  console.log("Запрос", ELEC_COPPER_URL, "...");
  const res = await fetch(ELEC_COPPER_URL);
  if (!res.ok) throw new Error("Elec.ru: " + res.status);
  const html = await res.text();
  const usdPerTonne = parseUsdPerTonneFromHtml(html);
  console.log("Курс ЦБ USD/RUB...");
  const usdRub = await getUsdRubToday();

  const rubPerGram = (usdPerTonne / 1_000_000) * usdRub;
  const today = new Date().toISOString().slice(0, 10);

  console.log("\n--- Результат ---");
  console.log("Источник: Elec.ru (LME Copper), парсинг страницы");
  console.log("Дата:", today);
  console.log("Медь LME (USD/т):", usdPerTonne);
  console.log("USD/RUB (ЦБ):", usdRub);
  console.log("Медь (руб/г):", rubPerGram.toFixed(4));
  console.log("\nДля истории нужно вызывать скрипт ежедневно и накапливать даты в БД/JSON. Надёжнее для истории — MOEX (scripts/fetch-copper-price-moex.js).");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
