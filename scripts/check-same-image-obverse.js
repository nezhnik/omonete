/**
 * Находит монеты с одинаковым image_obverse (одна картинка у разных монет).
 * Так проявляется перезапись: Kangaroo, Wedge-tailed Eagle и др. показывают Kookaburra.
 *
 * Запуск: node scripts/check-same-image-obverse.js
 */
require("dotenv").config({ path: ".env" });
const mysql = require("mysql2/promise");

function getConfig() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL не задан");
  const m = url.match(/mysql:\/\/([^:]+):([^@]+)@([^:]+):(\d+)\/(.+)/);
  if (!m) throw new Error("Неверный формат DATABASE_URL");
  const [, user, password, host, port, database] = m;
  return { host, port: parseInt(port, 10), user, password, database };
}

async function main() {
  const conn = await mysql.createConnection(getConfig());

  const [rows] = await conn.execute(
    `SELECT id, title, country, series, mint, source_url, image_obverse, image_reverse
     FROM coins
     WHERE image_obverse IS NOT NULL AND TRIM(image_obverse) != ''
     ORDER BY image_obverse, id`
  );

  const byObverse = new Map();
  for (const r of rows) {
    const obv = String(r.image_obverse).trim();
    if (!byObverse.has(obv)) byObverse.set(obv, []);
    byObverse.get(obv).push(r);
  }

  const baseUrl = process.env.SITE_URL || "http://localhost:3000";
  let totalShared = 0;

  console.log("=== Одна картинка у нескольких монет (image_obverse) ===\n");

  for (const [obv, arr] of byObverse) {
    if (arr.length <= 1) continue;
    totalShared += arr.length;
    const shortPath = obv.length > 70 ? "..." + obv.slice(-67) : obv;
    console.log("image_obverse (" + arr.length + " монет): " + shortPath);
    for (const r of arr.slice(0, 15)) {
      console.log("  id=" + r.id + "  " + (r.country || "") + "  " + (r.title || "").slice(0, 58));
      console.log("    " + baseUrl + "/coins/" + r.id + "/");
    }
    if (arr.length > 15) console.log("  ... и ещё " + (arr.length - 15) + " монет");
    console.log("");
  }

  console.log("--- Итого: групп с повторяющейся картинкой:", [...byObverse].filter(([, a]) => a.length > 1).length);
  console.log("--- Всего монет с «чужой» картинкой (в группах >1):", totalShared);

  await conn.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
