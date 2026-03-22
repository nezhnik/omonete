/**
 * Кладёт результат fetch-royal-mint-coin-test.js в обычный каталог сайта (как остальные монеты).
 *
 *   npx tsx scripts/royal-mint-to-public-catalog.ts
 *   npx tsx scripts/royal-mint-to-public-catalog.ts data/royal-mint-другой-slug.json
 *
 * Потом: npm run dev → http://localhost:3000/coins/991001/
 * Через БД (как Perth): npm run royal-mint:import → npm run data:export — тогда id будет из MySQL, этот скрипт не нужен.
 *
 * ID по умолчанию 991001 (не пересекается с экспортом из БД). Другой id: ROYAL_MINT_LOCAL_ID=991002 npx tsx ...
 */
import fs from "fs";
import path from "path";
import { mapRoyalMintJsonToCoinDetail } from "../lib/mapRoyalMintJsonToCoinDetail";

const DEFAULT_JSON = path.join(process.cwd(), "data", "royal-mint-rqp252s-the-royal-tudor-beasts-2025-queens-panther-2oz-silver-bullion-coin.json");

function main() {
  const arg = process.argv[2];
  const src = arg ? (path.isAbsolute(arg) ? arg : path.join(process.cwd(), arg)) : DEFAULT_JSON;
  const coinId = String(process.env.ROYAL_MINT_LOCAL_ID || "991001").trim();

  if (!fs.existsSync(src)) {
    console.error("Нет файла:", src);
    console.error("Сначала: npm run royal-mint:fetch-test -- --no-images \"https://...\"");
    process.exit(1);
  }

  const raw = JSON.parse(fs.readFileSync(src, "utf8"));
  const mapped = mapRoyalMintJsonToCoinDetail(raw);
  if (!mapped) {
    console.error("Не удалось разобрать JSON (нет coin.title).");
    process.exit(1);
  }

  mapped.coin.id = coinId;

  const outDir = path.join(process.cwd(), "public", "data", "coins");
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
  const outFile = path.join(outDir, `${coinId}.json`);
  fs.writeFileSync(outFile, JSON.stringify(mapped, null, 2), "utf8");
  console.log("Записано:", outFile);

  const idsPath = path.join(process.cwd(), "public", "data", "coin-ids.json");
  const ids: string[] = JSON.parse(fs.readFileSync(idsPath, "utf8"));
  if (!ids.includes(coinId)) {
    ids.unshift(coinId);
    fs.writeFileSync(idsPath, JSON.stringify(ids), "utf8");
    console.log("Добавлен id в coin-ids.json:", coinId);
  } else {
    console.log("id уже есть в coin-ids.json:", coinId);
  }

  console.log("\nОткрой: http://localhost:3000/coins/" + coinId + "/");
}

main();
