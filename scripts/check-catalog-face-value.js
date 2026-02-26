/**
 * Проверка: монеты с картинками — соответствие catalog_number и face_value/metal.
 * ЦБ: префикс 5015 = 25 рублей (медно-никелевый сплав), 5117 = 3 рубля серебро и др.
 * Запуск: node scripts/check-catalog-face-value.js
 */
require("dotenv").config({ path: ".env" });
const mysql = require("mysql2/promise");

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

  // Монеты с обеими картинками (скачанные)
  const [rows] = await conn.execute(
    `SELECT id, catalog_number, title, series, face_value, metal, metal_fineness
     FROM coins
     WHERE image_obverse IS NOT NULL AND image_obverse != ''
       AND image_reverse IS NOT NULL AND image_reverse != ''
     ORDER BY catalog_number`
  );
  await conn.end();

  // По справочнику ЦБ: 5015-xxxx = 25 рублей, медно-никелевый сплав (не драгметалл)
  const PREFIX_25_RUB = "5015-";
  const wrong = rows.filter(
    (r) =>
      r.catalog_number &&
      String(r.catalog_number).startsWith(PREFIX_25_RUB) &&
      (r.face_value !== "25 рублей" || (r.metal && !r.metal.toLowerCase().includes("медно-никел")))
  );

  console.log("Всего монет с картинками:", rows.length);
  console.log("");
  console.log("Серия «Российская (советская) мультипликация» (каталожный 5015-xxxx = 25 руб., сплав):");
  const mult = rows.filter(
    (r) =>
      r.series && r.series.includes("мультипликация") ||
      (r.catalog_number && String(r.catalog_number).startsWith(PREFIX_25_RUB))
  );
  mult.forEach((r) => {
    const ok = r.catalog_number && String(r.catalog_number).startsWith(PREFIX_25_RUB) &&
      r.face_value === "25 рублей" && r.metal && r.metal.toLowerCase().includes("медно-никел");
    console.log(
      (ok ? "  ✓" : "  ✗"),
      r.catalog_number,
      "|",
      r.face_value,
      "|",
      (r.metal || "").slice(0, 35),
      "|",
      (r.title || "").slice(0, 40)
    );
  });

  console.log("");
  console.log("Несоответствие (5015-xxxx, но в БД не 25 руб. или не сплав):", wrong.length);
  wrong.forEach((r) => {
    console.log("  ", r.id, r.catalog_number, "|", r.face_value, "|", r.metal, "|", r.title?.slice(0, 50));
  });
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
