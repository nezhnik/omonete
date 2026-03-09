/**
 * Проверка: совпадают ли названия и годы монет с файлами в маппинге.
 * Запуск: node scripts/verify-expo-kookaburra-mapping.js
 */

require("dotenv").config({ path: ".env" });
const mysql = require("mysql2/promise");

const MAPPING = [
  { id: 4415, file: "brisbane-2022" },
  { id: 4416, file: "brisbane-2023" },
  { id: 4504, file: "melbourne-2022-leadbeater-possum-privy" },
  { id: 4506, file: "melbourne-2023" },
  { id: 4536, file: "perth-2022-numbat-privy" },
  { id: 4557, file: "sydney-2022" },
  { id: 4558, file: "sydney-2023" },
  { id: 4612, file: "world-money-fair-2022" },
  { id: 4613, file: "world-money-fair-2023" },
  { id: 4614, file: "world-money-fair-2024" },
];

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

  console.log("=== Проверка: монета в БД vs файл в foreign ===\n");
  for (const row of MAPPING) {
    const [r] = await conn.execute(
      "SELECT id, title, catalog_number, release_date, series FROM coins WHERE id = ?",
      [row.id]
    );
    if (r.length === 0) {
      console.log(`id=${row.id} — НЕТ В БД! Ожидаемый файл: ${row.file}`);
      continue;
    }
    const c = r[0];
    const year = c.release_date ? String(c.release_date).slice(0, 4) : "?";
    const title = (c.title || "").slice(0, 70);
    const ok = (row.file.includes(year) || (row.file.includes("2022") && year === "2022") && 
               (c.series === "Australian Kookaburra" || (c.title || "").toLowerCase().includes("kookaburra"));
    console.log(ok ? "✓" : "? ", `id=${row.id} ${year} | ${title}`);
    console.log(`    файл: ${row.file}`);
    if (!ok) console.log("    ВНИМАНИЕ: год/название могут не совпадать!");
    console.log();
  }
  await conn.end();
}

main().catch((e) => { console.error(e); process.exit(1); });
