/**
 * Собирает URL проблемных монет Perth: в БД есть source_url на perthmint.com,
 * но нет своей картинки (image_obverse или image_reverse пустые).
 * Пишет уникальные URL в perth-mint-refetch-urls.txt для последующего:
 *   node scripts/fetch-perth-mint-coin.js --refetch-lost --refresh --no-image-cache
 *
 * Запуск:
 *   node scripts/list-perth-problem-urls.js           — все проблемные
 *   node scripts/list-perth-problem-urls.js --sovereign — только с "Sovereign" в названии
 */
require("dotenv").config({ path: ".env" });
const fs = require("fs");
const path = require("path");
const mysql = require("mysql2/promise");

const onlySovereign = process.argv.includes("--sovereign");

function getConfig() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL не задан");
  const m = url.match(/mysql:\/\/([^:]+):([^@]+)@([^:]+):(\d+)\/(.+)/);
  if (!m) throw new Error("Неверный формат DATABASE_URL");
  const [, user, password, host, port, database] = m;
  return { host, port: parseInt(port, 10), user, password, database };
}

function normUrl(u) {
  if (!u || typeof u !== "string") return null;
  return u.trim().replace(/\/+$/, "") || null;
}

const REFETCH_FILE = path.join(__dirname, "perth-mint-refetch-urls.txt");

async function main() {
  const conn = await mysql.createConnection(getConfig());
  let sql = `SELECT id, title, source_url, image_obverse, image_reverse
     FROM coins
     WHERE (mint LIKE '%Perth%' OR mint_short LIKE '%Perth%')
       AND source_url IS NOT NULL AND source_url LIKE '%perthmint.com%'
       AND (
         (image_obverse IS NULL OR TRIM(image_obverse) = '')
         OR (image_reverse IS NULL OR TRIM(image_reverse) = '')
       )`;
  if (onlySovereign) sql += ` AND title LIKE '%Sovereign%'`;
  sql += ` ORDER BY id`;
  const [rows] = await conn.execute(sql);
  await conn.end();

  if (onlySovereign) console.log("Фильтр: только монеты с 'Sovereign' в названии.");

  const urls = [];
  const seen = new Set();
  for (const r of rows) {
    const u = normUrl(r.source_url);
    if (u && !seen.has(u)) {
      seen.add(u);
      urls.push(u);
    }
  }

  console.log("Проблемных монет Perth (нет аверса/реверса) в БД:", rows.length);
  console.log("Уникальных URL для перезагрузки с сайта:", urls.length);
  if (rows.length > 0) {
    console.log("\nПримеры записей:");
    rows.slice(0, 5).forEach((r) => {
      console.log("  id=" + r.id + "  " + (r.title || "").slice(0, 55));
    });
  }

  fs.writeFileSync(REFETCH_FILE, urls.join("\n") + (urls.length ? "\n" : ""), "utf8");
  console.log("\n✓ URL записаны в " + REFETCH_FILE);
  console.log("\nДальше запусти:");
  console.log("  node scripts/fetch-perth-mint-coin.js --refetch-lost --refresh --no-image-cache");
  console.log("(загрузит со страниц правильные название, характеристики и картинки)");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
