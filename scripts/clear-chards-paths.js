/**
 * Обнуляет пути chards-kookaburra у монет в БД.
 * Папка chards удалена — ссылки битые. Ставим NULL в image_obverse, image_reverse (и box/cert если chards).
 *
 * Запуск:
 *   node scripts/clear-chards-paths.js --dry
 *   node scripts/clear-chards-paths.js
 */

/* eslint-disable no-console */

require("dotenv").config({ path: ".env" });
const mysql = require("mysql2/promise");

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

  const [rows] = await conn.execute(
    `SELECT id, title, image_obverse, image_reverse, image_box, image_certificate
     FROM coins
     WHERE image_obverse LIKE '%chards-kookaburra%'
        OR image_reverse LIKE '%chards-kookaburra%'
        OR (image_box IS NOT NULL AND image_box LIKE '%chards-kookaburra%')
        OR (image_certificate IS NOT NULL AND image_certificate LIKE '%chards-kookaburra%')
     ORDER BY id`
  );

  console.log("Монет с chards путями:", rows.length);
  if (rows.length === 0) {
    await conn.end();
    return;
  }

  let updated = 0;
  for (const c of rows) {
    const updates = [];
    const values = [];
    if ((c.image_obverse || "").includes("chards-kookaburra")) {
      updates.push("image_obverse = NULL");
    }
    if ((c.image_reverse || "").includes("chards-kookaburra")) {
      updates.push("image_reverse = NULL");
    }
    if ((c.image_box || "").includes("chards-kookaburra")) {
      updates.push("image_box = NULL");
    }
    if ((c.image_certificate || "").includes("chards-kookaburra")) {
      updates.push("image_certificate = NULL");
    }
    if (updates.length === 0) continue;

    if (!dryRun) {
      await conn.execute(
        `UPDATE coins SET ${updates.join(", ")} WHERE id = ?`,
        [c.id]
      );
    }
    updated++;
    console.log(dryRun ? "  [dry] " : "  ", `id=${c.id} ${(c.title || "").slice(0, 50)}`);
  }

  await conn.end();
  console.log("\nГотово.", dryRun ? "(dry run)" : "", "Обновлено:", updated);
  if (!dryRun && updated > 0) {
    console.log("Дальше: npm run data:export:incremental && npm run build");
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
