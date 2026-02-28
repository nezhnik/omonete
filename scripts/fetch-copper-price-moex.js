/**
 * Цена меди из MOEX ISS API — бесплатно, без ключей.
 * Фьючерс COPPER: цена в рублях за 10 кг → руб/г = SETTLEPRICE / 10000.
 * История на MOEX — с окт. 2024.
 *
 * Запуск: node scripts/fetch-copper-price-moex.js
 * Опционально: COPPER_DAYS=60 — за сколько дней забрать историю (по умолчанию 30).
 */
const ISS_BASE = "https://iss.moex.com/iss";
const RUB_PER_GRAM_DIVISOR = 10000; // SETTLEPRICE за 10 кг → руб/г

async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`MOEX: ${res.status} ${url}`);
  return res.json();
}

/** Найти ближайший по дате экспирации контракт COPPER. */
async function getFrontCopperSecId() {
  const url = `${ISS_BASE}/engines/futures/markets/forts/securities.json?limit=1000`;
  const data = await fetchJson(url);
  const rows = data?.securities?.data || [];
  const cols = (data?.securities?.columns || []).map((c) => c.toLowerCase());
  const idx = { secid: cols.indexOf("secid"), assetcode: cols.indexOf("assetcode"), lasttradedate: cols.indexOf("lasttradedate") };
  if (idx.assetcode === -1 || idx.secid === -1) throw new Error("MOEX: не найден формат securities");

  const coppers = rows.filter((r) => (r[idx.assetcode] || "").toUpperCase() === "COPPER");
  if (!coppers.length) throw new Error("MOEX: нет контрактов COPPER");
  const now = new Date().toISOString().slice(0, 10);
  const withDate = coppers.map((r) => ({ secid: r[idx.secid], last: r[idx.lasttradedate] || "" }));
  const future = withDate.filter((r) => r.last >= now).sort((a, b) => a.last.localeCompare(b.last));
  const secid = (future[0] || withDate[0]).secid;
  return secid;
}

/** История по контракту: массив { date, xcu } (руб/г). */
async function fetchCopperHistory(secid, days = 30) {
  const end = new Date();
  const start = new Date(end);
  start.setDate(start.getDate() - Math.max(1, days));
  const from = start.toISOString().slice(0, 10);
  const till = end.toISOString().slice(0, 10);
  const url = `${ISS_BASE}/history/engines/futures/markets/forts/securities/${secid}.json?from=${from}&till=${till}`;
  const data = await fetchJson(url);
  const rows = data?.history?.data || [];
  const cols = (data?.history?.columns || []).map((c) => c.toLowerCase());
  const idxDate = cols.indexOf("tradedate");
  const idxSettle = cols.indexOf("settleprice");
  const idxClose = cols.indexOf("close");
  const priceCol = idxSettle >= 0 ? idxSettle : idxClose;
  if (idxDate < 0 || priceCol < 0) throw new Error("MOEX: нет tradedate или settleprice в history");

  return rows.map((r) => {
    const date = String(r[idxDate] || "").slice(0, 10);
    const price = Number(r[priceCol]) || 0;
    const xcu = price / RUB_PER_GRAM_DIVISOR;
    return { date, xcu };
  }).filter((r) => r.date && r.xcu > 0);
}

async function main() {
  const days = Math.min(365, Math.max(1, parseInt(process.env.COPPER_DAYS, 10) || 30));
  console.log("MOEX ISS: контракт COPPER...");
  const secid = await getFrontCopperSecId();
  console.log("MOEX ISS: история за последние", days, "дней, контракт", secid, "...");
  const history = await fetchCopperHistory(secid, days);
  if (!history.length) {
    console.log("Нет данных за период.");
    return;
  }
  const last = history[history.length - 1];
  console.log("\n--- Результат (медь, руб/г) ---");
  console.log("Источник: MOEX ISS (фьючерс COPPER), бесплатно");
  console.log("Последняя дата:", last.date, "→", last.xcu.toFixed(4), "руб/г");
  console.log("Всего дней:", history.length);
  console.log("\nМассив для интеграции (первые 3 и последние 2):");
  history.slice(0, 3).forEach((r) => console.log(" ", r.date, r.xcu.toFixed(4)));
  if (history.length > 5) console.log(" ...");
  history.slice(-2).forEach((r) => console.log(" ", r.date, r.xcu.toFixed(4)));
  console.log("\nДальше: можно передать history в крон metal_prices (добавить столбец xcu в БД и экспорт в metal-prices.json как XCU).");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
