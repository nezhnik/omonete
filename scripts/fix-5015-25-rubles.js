/**
 * Исправляет номинал и металл по каталожному номеру ЦБ:
 * 5015-xxxx = 25 рублей, медно-никелевый сплав (серия «Российская (советская) мультипликация» и др.).
 * В БД часто ошибочно заведены как 3 рубля серебро — картинки мы качаем по catalog_number, поэтому
 * на сайте показывается 25 руб., а в характеристиках было 3 руб. серебро.
 *
 * Запуск: node scripts/fix-5015-25-rubles.js       — показать, что будет обновлено
 *         node scripts/fix-5015-25-rubles.js --apply — выполнить обновление
 */
require("dotenv").config({ path: ".env" });
const mysql = require("mysql2/promise");

const DRY_RUN = !process.argv.includes("--apply");
const PREFIX_25_RUB = "5015-";

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
    `SELECT id, catalog_number, title, face_value, metal
     FROM coins
     WHERE catalog_number LIKE ?
     ORDER BY catalog_number`,
    [PREFIX_25_RUB + "%"]
  );

  const toFix = rows.filter(
    (r) =>
      r.face_value !== "25 рублей" ||
      !r.metal ||
      !r.metal.toLowerCase().includes("медно-никел")
  );

  console.log("Монет с каталожным номером 5015-xxxx (по ЦБ: 25 руб., сплав):", rows.length);
  console.log("Из них с неверным номиналом/металлом в БД:", toFix.length);
  if (toFix.length === 0) {
    await conn.end();
    return;
  }
  console.log("");
  toFix.forEach((r) => {
    console.log("  ", r.catalog_number, "|", r.face_value, "|", (r.metal || "").slice(0, 30), "|", r.title?.slice(0, 45));
  });
  console.log("");
  console.log("Будет выставлено: face_value = '25 рублей', metal = 'Медно-никелевый сплав', metal_fineness = NULL");

  if (DRY_RUN) {
    console.log("\nРежим просмотра. Применить: node scripts/fix-5015-25-rubles.js --apply");
    await conn.end();
    return;
  }

  const [result] = await conn.execute(
    `UPDATE coins
     SET face_value = '25 рублей', metal = 'Медно-никелевый сплав', metal_fineness = NULL
     WHERE catalog_number LIKE ?`,
    [PREFIX_25_RUB + "%"]
  );
  console.log("\nОбновлено записей:", result.affectedRows);
  await conn.end();
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
