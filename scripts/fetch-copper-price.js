/**
 * Цена меди: LME (USD) + курс ЦБ USD/RUB → руб/г.
 * Источники меди (один на выбор): Commodities-API или Metals-API (бесплатные ключи).
 * Курс USD: https://www.cbr-xml-daily.ru/daily_json.js
 * Формула: руб/г = (цена меди USD/тонна / 1_000_000) × курс_USD_RUB
 *
 * Запуск: node scripts/fetch-copper-price.js
 * В .env задать COMMODITIES_API_KEY или METALS_API_KEY (хотя бы один).
 */
require("dotenv").config({ path: ".env" });

const COMMODITIES_API_KEY = process.env.COMMODITIES_API_KEY;
const METALS_API_KEY = process.env.METALS_API_KEY;
const CBR_JSON = "https://www.cbr-xml-daily.ru/daily_json.js";

const GRAMS_PER_TROY_OZ = 31.1034768;

async function getUsdRubToday() {
  const res = await fetch(CBR_JSON);
  if (!res.ok) throw new Error("CBR: " + res.status);
  const data = await res.json();
  const usd = data?.Valute?.USD;
  if (!usd || usd.Value == null) throw new Error("CBR: нет курса USD");
  return Number(usd.Value);
}

/** Commodities-API: LME-XCU, обычно в USD за тонну. */
async function getCopperViaCommoditiesApi() {
  const url = `https://commodities-api.com/api/latest?access_key=${COMMODITIES_API_KEY}&base=USD&symbols=LME-XCU`;
  const res = await fetch(url);
  if (!res.ok) throw new Error("Commodities-API: " + res.status);
  const data = await res.json();
  if (data?.rates?.["LME-XCU"] == null) throw new Error("Commodities-API: нет LME-XCU");
  const rate = Number(data.rates["LME-XCU"]);
  // Если значение большое (тысячи) — это USD/тонна; если < 20 — скорее USD за тройскую унцию
  const usdPerTonne = rate > 100 ? rate : rate * (1_000_000 / GRAMS_PER_TROY_OZ);
  return { usdPerTonne, source: "Commodities-API" };
}

/** Metals-API: LME-XCU в USD за тройскую унцию (unit: per troy ounce). */
async function getCopperViaMetalsApi() {
  const url = `https://api.metals-api.com/api/latest?access_key=${METALS_API_KEY}&base=USD&symbols=LME-XCU`;
  const res = await fetch(url);
  if (!res.ok) throw new Error("Metals-API: " + res.status);
  const data = await res.json();
  if (data?.rates?.["LME-XCU"] == null) throw new Error("Metals-API: нет LME-XCU");
  const usdPerTroyOz = Number(data.rates["LME-XCU"]);
  const usdPerTonne = usdPerTroyOz * (1_000_000 / GRAMS_PER_TROY_OZ);
  return { usdPerTonne, source: "Metals-API" };
}

async function getLmeCopperUsdPerTonne() {
  if (COMMODITIES_API_KEY) {
    return getCopperViaCommoditiesApi();
  }
  if (METALS_API_KEY) {
    return getCopperViaMetalsApi();
  }
  console.error("Задайте в .env один из ключей:");
  console.error("  COMMODITIES_API_KEY=...  (commodities-api.com)");
  console.error("  METALS_API_KEY=...       (metals-api.com)");
  process.exit(1);
}

async function main() {
  console.log("Курс ЦБ USD/RUB...");
  const usdRub = await getUsdRubToday();
  console.log("Цена меди LME...");
  const { usdPerTonne, source } = await getLmeCopperUsdPerTonne();

  const rubPerGram = (usdPerTonne / 1_000_000) * usdRub;
  const rubPerKg = (usdPerTonne / 1000) * usdRub;

  console.log("\n--- Результат ---");
  console.log("Источник меди:", source);
  console.log("USD/RUB (ЦБ):", usdRub);
  console.log("Медь LME (USD/т):", usdPerTonne.toFixed(2));
  console.log("Медь (руб/г):", rubPerGram.toFixed(4));
  console.log("Медь (руб/кг):", rubPerKg.toFixed(2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
