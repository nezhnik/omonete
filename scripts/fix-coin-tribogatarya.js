/**
 * Исправляет данные монеты «Три богатыря» под справочник ЦБ: 25 рублей, медно-никелевый сплав
 * (картинка 5015-0020 — это 25 руб., в БД ошибочно осталось 3 руб. и серебро от другой монеты).
 * Запуск: node scripts/fix-coin-tribogatarya.js
 */
require("dotenv").config({ path: ".env" });
const mysql = require("mysql2/promise");

async function run() {
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
    `SELECT id, catalog_number, title, face_value, metal, metal_fineness, image_obverse
     FROM coins WHERE title LIKE '%Три богатыря%' AND face_value = '3 рубля' AND (image_obverse LIKE '%5015-0020%' OR catalog_number = '5015-0020')`
  );
  if (rows.length === 0) {
    console.log("Запись для исправления не найдена (возможно, уже исправлена).");
    await conn.end();
    return;
  }
  console.log("Найдено записей для исправления:", rows.length);
  for (const r of rows) {
    console.log("  id:", r.id, "|", r.title, "|", r.face_value, "|", r.metal);
  }

  await conn.execute(
    `UPDATE coins SET face_value = '25 рублей', metal = 'Медно-никелевый сплав', metal_fineness = NULL
     WHERE title LIKE '%Три богатыря%' AND face_value = '3 рубля' AND (image_obverse LIKE '%5015-0020%' OR catalog_number = '5015-0020')`
  );
  console.log("Обновлено: номинал 25 рублей, металл Медно-никелевый сплав (по справочнику ЦБ).");
  await conn.end();
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
