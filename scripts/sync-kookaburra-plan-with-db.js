/**
 * Сверяет KOOKABURRA_SERIES_PLAN.md с coins.json (экспорт БД).
 * Для монет, которые уже есть в БД, проставляет status = in_db.
 *
 * План: /Users/mihail/Desktop/Нумизматика сайт/Файлы и документы по монетам/кукабарра/KOOKABURRA_SERIES_PLAN.md
 *
 * Запуск: node scripts/sync-kookaburra-plan-with-db.js
 */

/* eslint-disable no-console */

const fs = require("fs");
const path = require("path");

const PLAN_PATH = path.join(
  "/Users/mihail/Desktop/Нумизматика сайт",
  "Файлы и документы по монетам",
  "кукабарра",
  "KOOKABURRA_SERIES_PLAN.md"
);
const COINS_JSON = path.join(__dirname, "..", "public", "data", "coins.json");

function weightToType(w) {
  if (!w) return null;
  if (w >= 30 && w <= 33) return "regular-1oz";
  if (w >= 60 && w <= 65) return "regular-2oz";
  if (w >= 150 && w <= 165) return null; // 5oz — может быть proof-5oz или incuse-5oz
  if (w >= 305 && w <= 320) return "regular-10oz";
  if (w >= 995 && w <= 1010) return "regular-1kg";
  return null;
}

function inferVariant(title) {
  if (!title) return "regular";
  if (/privy|dragon\s|snake\s|horse\s|goat\s/i.test(title)) return "privy";
  return "regular";
}

function loadKookaburraFromDb() {
  const data = JSON.parse(fs.readFileSync(COINS_JSON, "utf8"));
  const kook = data.coins.filter(
    (c) =>
      (c.title && /kookaburra/i.test(c.title)) ||
      (c.seriesName && /kookaburra/i.test(c.seriesName))
  );
  const byKey = new Set();
  for (const c of kook) {
    const type = weightToType(c.weightG);
    if (type) {
      const v = inferVariant(c.title);
      byKey.add(`${type}-${c.year}-${v}`);
      byKey.add(`${type}-${c.year}`); // любой вариант тоже матчит общий ключ
    }
    if (c.weightG >= 150 && c.weightG <= 165) {
      const t = /incuse|incused/i.test(c.title) ? "incuse-5oz" : "proof-5oz";
      byKey.add(`${t}-${c.year}`);
    }
  }
  return byKey;
}

function processPlan(planPath, dbKeys) {
  const text = fs.readFileSync(planPath, "utf8");
  const lines = text.split(/\r?\n/);
  const typeToWeight = {
    "regular-1oz": "1oz",
    "regular-2oz": "2oz",
    "regular-10oz": "10oz",
    "regular-1kg": "1kg",
    "proof-5oz": "5oz",
    "incuse-5oz": "5oz",
  };

  const newLines = [];
  let updated = 0;

  for (const line of lines) {
    if (!line.startsWith("|") || line.startsWith("| year") || line.startsWith("|------")) {
      newLines.push(line);
      continue;
    }

    const cells = line.split("|").slice(1, -1).map((c) => c.trim());
    if (cells.length !== 16) {
      newLines.push(line);
      continue;
    }

    const [yearStr, type, variant] = cells;
    const year = parseInt(yearStr, 10);
    if (isNaN(year)) {
      newLines.push(line);
      continue;
    }
    const statusCol = 14;
    const v = (variant || "").trim() || "regular";
    const key = `${type}-${year}-${v}`;
    const keyAny = `${type}-${year}`;
    const inDb = dbKeys.has(key) || dbKeys.has(keyAny);

    if (inDb && cells[statusCol] !== "in_db") {
      cells[statusCol] = "in_db";
      updated++;
      newLines.push("| " + cells.join(" | ") + " |");
    } else {
      newLines.push(line);
    }
  }

  return { newLines, updated };
}

function main() {
  if (!fs.existsSync(PLAN_PATH)) {
    console.error("Не найден план:", PLAN_PATH);
    process.exit(1);
  }
  if (!fs.existsSync(COINS_JSON)) {
    console.error("Не найден coins.json:", COINS_JSON);
    process.exit(1);
  }

  const dbKeys = loadKookaburraFromDb();
  console.log("Kookaburra в БД (уникальных ключей):", dbKeys.size);
  console.log("Примеры:", [...dbKeys].slice(0, 12).join(", "));

  const { newLines, updated } = processPlan(PLAN_PATH, dbKeys);
  fs.writeFileSync(PLAN_PATH, newLines.join("\n"), "utf8");

  console.log("Обновлено строк (status → in_db):", updated);
}

main();
