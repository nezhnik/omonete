/**
 * Проверка монет по полю mint (монетный двор):
 * 1. Монеты без МД (mint пустой или "—")
 * 2. Монеты с HTML-тегами в mint (<br>, &nbsp; и т.п.)
 * 3. Монеты с лишним текстом (Оформление гурта, рифлений и т.п.)
 *
 * Запуск: node scripts/check-mint-issues.js
 */
require("dotenv").config({ path: ".env" });
const mysql = require("mysql2/promise");
const fs = require("fs");
const path = require("path");

const HAS_HTML = /<br\s*\/?>|&nbsp;|&mdash;|<\/?p>|<\/?div>/i;
const HAS_EXTRA_TEXT = /Оформление|рифлен|гурт|<\/p>|<p\s|^\s*<p>/i;
const CBR_URL = "https://www.cbr.ru/cash_circulation/memorable_coins/coins_base/ShowCoins/?cat_num=";

async function run() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL не задан в .env");
    process.exit(1);
  }
  const m = url.match(/mysql:\/\/([^:]+):([^@]+)@([^:]+):(\d+)\/(.+)/);
  if (!m) {
    console.error("Неверный формат DATABASE_URL");
    process.exit(1);
  }
  const [, user, password, host, port, database] = m;
  const conn = await mysql.createConnection({
    host,
    port: parseInt(port, 10),
    user,
    password,
    database,
  });

  const [rows] = await conn.execute(
    `SELECT id, catalog_number, title, mint FROM coins 
     WHERE (country = 'Россия' OR country IS NULL) AND catalog_number IS NOT NULL AND TRIM(catalog_number) != ''
     ORDER BY catalog_number ASC`
  );
  await conn.end();

  const noMint = [];
  const hasHtml = [];
  const hasExtraText = [];

  for (const r of rows) {
    const mint = r.mint != null ? String(r.mint).trim() : "";
    const cat = r.catalog_number || "";
    const title = (r.title || "").slice(0, 60);
    const line = { id: r.id, cat, title, mint };

    if (!mint || mint === "—") {
      noMint.push(line);
      continue;
    }

    if (HAS_HTML.test(mint)) {
      hasHtml.push(line);
    }
    if (HAS_EXTRA_TEXT.test(mint)) {
      hasExtraText.push(line);
    }
  }

  const cbrLink = (cat) => `[${cat}](${CBR_URL}${encodeURIComponent(cat)})`;
  const issues = [];
  if (noMint.length > 0) issues.push({ label: "Без МД (mint пустой или «—»)", items: noMint, fmt: (x) => `${cbrLink(x.cat)} | id ${x.id} | ${x.title}` });
  if (hasHtml.length > 0) issues.push({ label: "С HTML в mint (<br>, &nbsp; и т.п.)", items: hasHtml, fmt: (x) => `${cbrLink(x.cat)} | id ${x.id} | mint: «${(x.mint || "").slice(0, 80)}${(x.mint || "").length > 80 ? "…" : ""}»` });
  if (hasExtraText.length > 0) issues.push({ label: "С лишним текстом (Оформление гурта и т.п.)", items: hasExtraText, fmt: (x) => `${cbrLink(x.cat)} | id ${x.id} | mint: «${(x.mint || "").slice(0, 80)}${(x.mint || "").length > 80 ? "…" : ""}»` });

  const problemIds = new Set([...noMint, ...hasHtml, ...hasExtraText].map((x) => x.id));
  const out = [];
  out.push("# Монеты с проблемами по полю mint (монетный двор)\n");
  out.push(`Всего российских монет: ${rows.length}. С проблемами: ${problemIds.size}\n`);

  if (issues.length === 0) {
    out.push("\nВсе монеты в порядке — проблем с mint нет.\n");
  } else {
    issues.forEach(({ label, items, fmt }, i) => {
      out.push(`\n## ${i + 1}. ${label}\n`);
      out.push(`Количество: ${items.length}\n`);
      items.forEach((item) => out.push(`- ${fmt(item)}\n`));
    });
  }

  const reportPath = path.join(__dirname, "..", "check-mint-issues-report.md");
  fs.writeFileSync(reportPath, out.join(""), "utf8");
  console.log("Отчёт сохранён:", reportPath);
  console.log("\n--- Сводка ---");
  if (issues.length === 0) console.log("Все монеты в порядке.");
  else issues.forEach(({ label, items }) => console.log(`  ${label}: ${items.length}`));
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
