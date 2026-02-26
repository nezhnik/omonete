/**
 * Скачивает изображения монет с сайта ЦБ и сохраняет в public/image/coins/.
 * После успешной загрузки обновляет в БД image_obverse и image_reverse — тогда сайт отдаёт наши файлы, а не ссылку на ЦБ.
 *
 * Тест: node scripts/download-cbr-images.js  (первые 5 монет)
 * Все:  node scripts/download-cbr-images.js --all
 *
 * Запуск из корня omonete-app: node scripts/download-cbr-images.js
 */
require("dotenv").config({ path: ".env" });
const mysql = require("mysql2/promise");
const fs = require("fs");
const path = require("path");

const CBR_BASE = "https://www.cbr.ru/legacy/PhotoStore/img";
const OUT_DIR = path.join(__dirname, "..", "public", "image", "coins");
const LIMIT = process.argv.includes("--all") ? 10000 : 5;

async function download(url) {
  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok) return null;
  return Buffer.from(await res.arrayBuffer());
}

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
    `SELECT DISTINCT catalog_number FROM coins WHERE catalog_number IS NOT NULL AND catalog_number != '' ORDER BY catalog_number LIMIT ?`,
    [LIMIT]
  );

  if (!fs.existsSync(OUT_DIR)) {
    fs.mkdirSync(OUT_DIR, { recursive: true });
    console.log("Создана папка:", OUT_DIR);
  }

  let ok = 0;
  let fail = 0;

  for (const row of rows) {
    const cat = String(row.catalog_number).trim();
    const obverseUrl = `${CBR_BASE}/${cat}.jpg`;
    const reverseUrl = `${CBR_BASE}/${cat}r.jpg`;

    const obversePath = path.join(OUT_DIR, `${cat}.jpg`);
    const reversePath = path.join(OUT_DIR, `${cat}r.jpg`);

    // На ЦБ: без r = реверс, с r = аверс. Наш аверс = их r.jpg, наш реверс = их .jpg
    const bufFromCbrJpg = await download(obverseUrl);
    const bufFromCbrR = await download(reverseUrl);

    if (bufFromCbrR && bufFromCbrR.length > 0) {
      fs.writeFileSync(obversePath, bufFromCbrR);
      console.log("  ✓", cat + ".jpg (аверс)");
      ok++;
    } else {
      console.log("  —", cat + "r.jpg (нет или ошибка)");
      fail++;
    }
    if (bufFromCbrJpg && bufFromCbrJpg.length > 0) {
      fs.writeFileSync(reversePath, bufFromCbrJpg);
      console.log("  ✓", cat + "r.jpg (реверс)");
      ok++;
    } else {
      console.log("  —", cat + ".jpg (нет или ошибка)");
      fail++;
    }

    if (bufFromCbrR?.length > 0 && bufFromCbrJpg?.length > 0) {
      const obversePathUrl = "/image/coins/" + cat + ".jpg";
      const reversePathUrl = "/image/coins/" + cat + "r.jpg";
      await conn.execute(
        "UPDATE coins SET image_obverse = ?, image_reverse = ? WHERE catalog_number = ?",
        [obversePathUrl, reversePathUrl, cat]
      );
      console.log("  → БД обновлена для", cat);
    }

    await new Promise((r) => setTimeout(r, 300));
  }

  await conn.end();
  console.log("\nГотово. Успешно:", ok, "Пропущено/ошибок:", fail);
  console.log("Файлы:", OUT_DIR);
  console.log("Сайт отдаёт их по адресу /image/coins/... — при деплое залей папку public/image/coins/ на сервер.");
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
