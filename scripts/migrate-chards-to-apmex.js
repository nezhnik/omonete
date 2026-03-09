/**
 * Переводит монеты Kookaburra с chards-kookaburra на kookaburra (папка с картинками).
 * Папка chards удалена — ссылки битые. Обновляет image_obverse, image_reverse в БД.
 * Использует kookaburra только там, где есть obv+rev (или slab как obv, если obv нет).
 *
 * Запуск:
 *   node scripts/migrate-chards-to-apmex.js
 *   node scripts/migrate-chards-to-apmex.js --dry
 */

/* eslint-disable no-console */

require("dotenv").config({ path: ".env" });
const mysql = require("mysql2/promise");
const fs = require("fs");
const path = require("path");

const KOOKABURRA_DIR = path.join(__dirname, "..", "public", "image", "coins", "kookaburra");

// weight_g → ключ apmex
function weightGToKey(w) {
  if (w == null) return null;
  const n = parseFloat(String(w));
  if (n >= 30 && n <= 32) return "1oz";
  if (n >= 60 && n <= 65) return "2oz";
  if (n >= 150 && n <= 160) return "5oz";
  if (n >= 305 && n <= 320) return "10oz";
  if (n >= 995 && n <= 1005) return "1kg";
  return null;
}

// Сканирует kookaburra: obv, rev, slab (slab как fallback для obv)
function parseKookaburraFile(name) {
  const m = name.match(/^kookaburra-(1oz|2oz|5oz|10oz|1kg)-(\d{4})(?:-[a-z-]+)?-(obv|rev|slab)\.(webp|jpeg|jpg)$/i);
  if (!m) return null;
  return { weight: m[1], year: parseInt(m[2], 10), side: m[3] };
}

function buildKookaburraMap() {
  if (!fs.existsSync(KOOKABURRA_DIR)) return new Map();
  const files = fs.readdirSync(KOOKABURRA_DIR);
  const byKey = new Map();
  for (const f of files) {
    const p = parseKookaburraFile(f);
    if (!p) continue;
    const key = `${p.year}-${p.weight}`;
    if (!byKey.has(key)) byKey.set(key, {});
    const rel = `/image/coins/kookaburra/${f}`;
    byKey.get(key)[p.side] = rel;
  }
  return byKey;
}

async function main() {
  const dryRun = process.argv.includes("--dry");

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

  const kookaburraMap = buildKookaburraMap();
  console.log("Записей kookaburra (year-weight):", kookaburraMap.size);

  const [chardsCoins] = await conn.execute(
    `SELECT id, title, release_date, weight_g, image_obverse, image_reverse
     FROM coins
     WHERE (image_obverse LIKE '%chards-kookaburra%' OR image_reverse LIKE '%chards-kookaburra%')
     ORDER BY id`
  );

  console.log("Монет с chards путями:", chardsCoins.length);
  if (chardsCoins.length === 0) {
    await conn.end();
    return;
  }

  let updated = 0;
  let skipped = 0;

  for (const c of chardsCoins) {
    const year = c.release_date ? new Date(c.release_date).getFullYear() : null;
    const weightKey = weightGToKey(c.weight_g);
    if (!year || !weightKey) {
      console.log(`  [skip] id=${c.id} — нет year или weight`);
      skipped++;
      continue;
    }

    const kook = kookaburraMap.get(`${year}-${weightKey}`);
    if (!kook) {
      console.log(`  [skip] id=${c.id} ${year} ${weightKey} — нет в kookaburra`);
      skipped++;
      continue;
    }

    let obv = kook.obv || null;
    let rev = kook.rev || null;
    if (!obv && kook.slab) obv = kook.slab; // slab как obv fallback
    if (!rev) {
      console.log(`  [skip] id=${c.id} ${year} ${weightKey} — нет rev в kookaburra`);
      skipped++;
      continue;
    }
    if (!obv) {
      console.log(`  [skip] id=${c.id} ${year} ${weightKey} — нет obv/slab в kookaburra`);
      skipped++;
      continue;
    }

    if (!dryRun) {
      await conn.execute(
        "UPDATE coins SET image_obverse = ?, image_reverse = ? WHERE id = ?",
        [obv, rev, c.id]
      );
    }
    console.log(`  [OK] id=${c.id} ${c.title?.slice(0, 50)} → kookaburra ${year} ${weightKey}`);
    updated++;
  }

  await conn.end();
  console.log("\nГотово.", dryRun ? "(dry run)" : "");
  console.log("Обновлено:", updated, "Пропущено:", skipped);
  if (!dryRun && updated > 0) {
    console.log("Дальше: npm run data:export:incremental && npm run build");
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
