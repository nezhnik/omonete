/**
 * Применяет пути к картинкам из KOOKABURRA_SERIES_PLAN.md к монетам в БД.
 * Обновляет image_obverse, image_reverse для Kookaburra по year + weight.
 * Не перезаписывает монеты, у которых уже есть image_obverse (без --force).
 *
 * Запуск:
 *   node scripts/apply-kookaburra-plan-to-db.js
 *   node scripts/apply-kookaburra-plan-to-db.js --force  (перезаписать всё)
 *   node scripts/apply-kookaburra-plan-to-db.js --dry    (только показать)
 */

require("dotenv").config({ path: ".env" });
const fs = require("fs");
const path = require("path");
const mysql = require("mysql2/promise");

const PLAN_PATH = path.join(
  "/Users/mihail/Desktop/Нумизматика сайт",
  "Файлы и документы по монетам",
  "кукабарра",
  "KOOKABURRA_SERIES_PLAN.md"
);

function typeToWeightG(type) {
  if (!type) return null;
  if (/regular-1oz|1oz/i.test(type)) return 31.1;
  if (/regular-2oz|2oz/i.test(type)) return 62.2;
  if (/5oz|proof-5oz|incuse-5oz/i.test(type)) return 155.5;
  if (/regular-10oz|10oz/i.test(type)) return 311;
  if (/regular-1kg|1kg/i.test(type)) return 1000;
  return null;
}

function parsePaths(s) {
  if (!s || typeof s !== "string") return null;
  const parts = s.split(",").map((p) => p.trim()).filter(Boolean);
  if (parts.length < 2) return null;
  // plan: rev first, obv second
  const rev = parts[0].startsWith("/") ? parts[0] : `/${parts[0]}`;
  const obv = parts[1].startsWith("/") ? parts[1] : `/${parts[1]}`;
  return { rev, obv };
}

function parsePlanRows(text) {
  const rows = [];
  const lines = text.split(/\r?\n/);
  for (const line of lines) {
    if (!line.startsWith("|") || line.startsWith("| year") || line.startsWith("|------")) continue;
    const cells = line.split("|").slice(1, -1).map((c) => c.trim());
    if (cells.length < 13) continue;
    const year = parseInt(cells[0], 10);
    const type = cells[1];
    const variant = (cells[2] || "").trim().toLowerCase();
    const imageSaved = cells[12];
    const paths = parsePaths(imageSaved);
    if (!year || !type || !paths) continue;
    const weightG = typeToWeightG(type);
    if (!weightG) continue;
    // privy: только rev в плане, obv от regular — пропускаем здесь, regular уже обновит obv
    if (variant === "privy") continue;
    rows.push({ year, type, weightG, rev: paths.rev, obv: paths.obv });
  }
  return rows;
}

async function main() {
  const dryRun = process.argv.includes("--dry");
  const force = process.argv.includes("--force");

  if (!fs.existsSync(PLAN_PATH)) {
    console.error("Не найден план:", PLAN_PATH);
    process.exit(1);
  }

  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL не задан");
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

  const planText = fs.readFileSync(PLAN_PATH, "utf8");
  const rows = parsePlanRows(planText);
  console.log("Записей из плана с картинками:", rows.length);

  let updated = 0;
  for (const r of rows) {
    const [coins] = await conn.execute(
      `SELECT id, title, image_obverse, image_reverse FROM coins
       WHERE (title LIKE '%kookaburra%' OR title LIKE '%кукабарра%' OR series LIKE '%kookaburra%'
          OR catalog_number LIKE '%KOOK%')
         AND (release_date IS NULL OR YEAR(release_date) = ?)
         AND weight_g IS NOT NULL AND weight_g >= ? AND weight_g <= ?
         ${!force ? "AND (image_obverse IS NULL OR TRIM(COALESCE(image_obverse, '')) = '')" : ""}
       LIMIT 100`,
      [r.year, r.weightG - 2, r.weightG + 2]
    );

    if (coins.length === 0) continue;

    if (!dryRun) {
      const ids = coins.map((c) => c.id);
      const placeholders = ids.map(() => "?").join(", ");
      await conn.execute(
        `UPDATE coins SET image_obverse = ?, image_reverse = ? WHERE id IN (${placeholders})`,
        [r.obv, r.rev, ...ids]
      );
    }
    updated += coins.length;
    console.log(`  ${r.year} ${r.type} (${r.weightG}g): ${coins.length} монет`);
  }

  await conn.end();
  console.log("\nГотово.", dryRun ? "(dry run)" : "", "Обновлено монет:", updated);
  if (!dryRun && updated > 0) {
    console.log("Дальше: npm run data:export:incremental && npm run build");
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
