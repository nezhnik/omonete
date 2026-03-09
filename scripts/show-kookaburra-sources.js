/**
 * Показывает source_url и источник картинок для всех монет Kookaburra.
 * Помогает понять, откуда каждая монета: Perth, APMEX, chards, foreign.
 *
 * Запуск: node scripts/show-kookaburra-sources.js
 */

/* eslint-disable no-console */

require("dotenv").config({ path: ".env" });
const mysql = require("mysql2/promise");

function imageSource(path) {
  if (!path) return "";
  if (path.includes("/foreign/") && path.includes("kookaburra")) return "foreign (kookaburra)";
  if (path.includes("/chards-kookaburra/")) return "chards";
  if (path.includes("/foreign/")) return "foreign";
  return "other";
}

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL не задан");
    process.exit(1);
  }
  const m = url.match(/mysql:\/\/([^:]+):([^@]+)@([^:]+):(\d+)\/(.+)/);
  const conn = await mysql.createConnection({
    host: m[3], port: parseInt(m[4], 10), user: m[1], password: m[2], database: m[5],
  });

  const [rows] = await conn.execute(
    `SELECT id, title, catalog_number, catalog_suffix, source_url, image_obverse, image_reverse
     FROM coins WHERE series = 'Australian Kookaburra' ORDER BY id`
  );

  const bySourceUrl = { perth: [], apmex: [], chards: [], empty: [] };
  for (const r of rows) {
    const src = (r.source_url || "").trim();
    const obvSrc = imageSource(r.image_obverse);
    const revSrc = imageSource(r.image_reverse);
    const imgInfo = obvSrc && revSrc ? (obvSrc === revSrc ? obvSrc : obvSrc + "+" + revSrc) : (obvSrc || revSrc || "—");
    const catalog = r.catalog_number + (r.catalog_suffix ? "-" + r.catalog_suffix : "");
    const line = { id: r.id, catalog, source_url: src || "—", images: imgInfo };
    if (src.includes("perthmint.com")) bySourceUrl.perth.push(line);
    else if (src.includes("apmex.com")) bySourceUrl.apmex.push(line);
    else if (src.includes("chards.co.uk")) bySourceUrl.chards.push(line);
    else bySourceUrl.empty.push(line);
  }

  console.log("=== Kookaburra: source_url + папка картинок ===\n");
  console.log("Всего монет:", rows.length, "\n");

  console.log("--- source_url = Perth Mint (perthmint.com) ---");
  bySourceUrl.perth.forEach((r) => console.log(`  id=${r.id} ${r.catalog} | картинки: ${r.images} | ${(r.source_url + "   ").substring(0, 65)}`));
  console.log("  Итого:", bySourceUrl.perth.length, "\n");

  console.log("--- source_url = APMEX ---");
  bySourceUrl.apmex.forEach((r) => console.log(`  id=${r.id} ${r.catalog} | ${r.images} | ${r.source_url}`));
  console.log("  Итого:", bySourceUrl.apmex.length, "\n");

  console.log("--- source_url = Chards ---");
  bySourceUrl.chards.forEach((r) => console.log(`  id=${r.id} ${r.catalog} | ${r.images} | ${r.source_url}`));
  console.log("  Итого:", bySourceUrl.chards.length, "\n");

  console.log("--- source_url пустой (импорт из плана / картинки kookaburra или foreign) ---");
  bySourceUrl.empty.forEach((r) => console.log(`  id=${r.id} ${r.catalog} | картинки: ${r.images} | source: ${r.source_url}`));
  console.log("  Итого:", bySourceUrl.empty.length);

  await conn.end();
}

main().catch((e) => { console.error(e); process.exit(1); });
