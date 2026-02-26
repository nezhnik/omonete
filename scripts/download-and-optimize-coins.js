/**
 * Всё в одном: скачать картинки с ЦБ → оптимизировать (размер + качество) → сохранить в public/image/coins/ → обновить БД.
 * После этого: npm run build → залить out на сервер. Каталог будет показывать монеты из БД с нашими картинками.
 *
 * Тест (5 монет):  node scripts/download-and-optimize-coins.js
 * Все монеты:      node scripts/download-and-optimize-coins.js --all
 *
 * Запуск из корня omonete-app.
 */
require("dotenv").config({ path: ".env" });
const mysql = require("mysql2/promise");
const fs = require("fs");
const path = require("path");
const sharp = require("sharp");

const CBR_BASE = "https://www.cbr.ru/legacy/PhotoStore/img";
const OUT_DIR = path.join(__dirname, "..", "public", "image", "coins");
const LIMIT = process.argv.includes("--all") ? 10000 : 5;

// Оптимизация: макс. 1200px по длинной стороне, WebP quality 88 (почти без потери качества, размер меньше)
const MAX_SIDE = 1200;
const WEBP_QUALITY = 88;

async function download(url) {
  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok) return null;
  return Buffer.from(await res.arrayBuffer());
}

async function optimize(buffer, outPath) {
  await sharp(buffer)
    .resize(MAX_SIDE, MAX_SIDE, { fit: "inside", withoutEnlargement: true })
    .webp({ quality: WEBP_QUALITY })
    .toFile(outPath);
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

    // На ЦБ: без r = реверс, с r = аверс. Сохраняем так: наш аверс = их r.jpg, наш реверс = их .jpg
    const bufFromCbrJpg = await download(obverseUrl);   // их cat.jpg (реверс)
    const bufFromCbrR = await download(reverseUrl);     // их cat r.jpg (аверс)

    const obverseWebp = cat + ".webp";
    const reverseWebp = cat + "r.webp";
    const obversePath = path.join(OUT_DIR, obverseWebp);
    const reversePath = path.join(OUT_DIR, reverseWebp);

    if (bufFromCbrR && bufFromCbrR.length > 0) {
      try {
        await optimize(bufFromCbrR, obversePath);
        console.log("  ✓", obverseWebp, "(аверс)");
        ok++;
      } catch (e) {
        console.log("  —", obverseWebp, e.message);
        fail++;
      }
    } else {
      console.log("  —", cat + "r.jpg (нет с ЦБ)");
      fail++;
    }
    if (bufFromCbrJpg && bufFromCbrJpg.length > 0) {
      try {
        await optimize(bufFromCbrJpg, reversePath);
        console.log("  ✓", reverseWebp, "(реверс)");
        ok++;
      } catch (e) {
        console.log("  —", reverseWebp, e.message);
        fail++;
      }
    } else {
      console.log("  —", cat + ".jpg (нет с ЦБ)");
      fail++;
    }

    if (bufFromCbrR?.length > 0 && bufFromCbrJpg?.length > 0) {
      const obversePathUrl = "/image/coins/" + obverseWebp;
      const reversePathUrl = "/image/coins/" + reverseWebp;
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
  console.log("Дальше: npm run build → залить содержимое папки out на сервер.");
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
