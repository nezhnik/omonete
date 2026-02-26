/**
 * Экспорт MINT_ARTICLES в mint-articles.json без dev-сервера.
 * Запуск: npm run mints:export:standalone (нужен npx tsx, ставится автоматически).
 */
import { MINT_ARTICLES } from "../lib/mint-articles";
import fs from "fs";
import path from "path";

const outPath = path.join(process.cwd(), "mint-articles.json");
fs.writeFileSync(outPath, JSON.stringify(MINT_ARTICLES, null, 2), "utf8");
console.log("✓ mint-articles.json записан, записей:", Object.keys(MINT_ARTICLES).length);
