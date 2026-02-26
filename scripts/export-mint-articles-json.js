/**
 * Экспорт MINT_ARTICLES из lib/mint-articles.ts в JSON для импорта в БД.
 * Запуск: node --loader ts-node/esm scripts/export-mint-articles-json.js
 *    или: npx ts-node --esm scripts/export-mint-articles-json.js
 * Альтернатива: в проекте с "type": "module" можно использовать динамический import.
 * Если ts-node недоступен — скрипт можно запустить из Next.js контекста или вручную экспортировать данные.
 */
const fs = require("fs");
const path = require("path");

async function run() {
  let MINT_ARTICLES;
  try {
    // Пробуем через ts-node (если установлен)
    require("ts-node/register");
    const mod = require("../lib/mint-articles.ts");
    MINT_ARTICLES = mod.MINT_ARTICLES || mod.default?.MINT_ARTICLES;
  } catch (e1) {
    try {
      const mod = require("../lib/mint-articles.js");
      MINT_ARTICLES = mod.MINT_ARTICLES || mod.default?.MINT_ARTICLES;
    } catch (e2) {
      console.error("Не удалось загрузить MINT_ARTICLES. Установите ts-node и запустите:");
      console.error("  npx ts-node -r tsconfig-paths/register scripts/export-mint-articles-json.js");
      console.error("Или скомпилируйте lib/mint-articles.ts в JS и запустите снова.");
      process.exit(1);
    }
  }
  if (!MINT_ARTICLES || typeof MINT_ARTICLES !== "object") {
    console.error("MINT_ARTICLES не найден в модуле.");
    process.exit(1);
  }
  const outPath = path.join(__dirname, "..", "mint-articles.json");
  fs.writeFileSync(outPath, JSON.stringify(MINT_ARTICLES, null, 2), "utf8");
  console.log("✓ mint-articles.json записан, записей:", Object.keys(MINT_ARTICLES).length);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
