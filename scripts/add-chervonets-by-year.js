/**
 * Червонец (3213-0010 и др.): по данным ЦБ один тип на 8 лет (1975–1982), у каждого года свой каталожный номер.
 * https://www.cbr.ru/cash_circulation/memorable_coins/coins_base/ShowCoins/?cat_num=3213-0010
 *
 * 1) Текущую монету id=4000 делаем выпуском 1975 года (catalog 3213-0002).
 * 2) Добавляем 7 монет: 1976–1982 с номерами 3213-0003, 3213-0004, 3213-0005, 3213-0006, 3213-0007, 3213-0009, 3213-0010.
 *    Картинки копируем с 4000 (один дизайн на все годы).
 *
 * Запуск: node scripts/add-chervonets-by-year.js
 */
require("dotenv").config({ path: ".env" });
const mysql = require("mysql2/promise");
const path = require("path");

const CHERVONETS_ID = 4000;

/** По данным ЦБ: год → каталожный номер (3213-0008 в списке нет). */
const YEAR_TO_CATALOG = [
  [1975, "3213-0002"],
  [1976, "3213-0003"],
  [1977, "3213-0004"],
  [1978, "3213-0005"],
  [1979, "3213-0006"],
  [1980, "3213-0007"],
  [1981, "3213-0009"],
  [1982, "3213-0010"],
];

async function run() {
  const envPath = path.join(__dirname, "..", ".env");
  require("dotenv").config({ path: envPath });
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
    `SELECT id, title, series, country, face_value, release_date, image_urls, catalog_number, catalog_suffix,
     image_obverse, image_reverse, image_box, image_certificate, mint, mint_short, metal, metal_fineness,
     mintage, mintage_display, weight_g, weight_oz, quality, diameter_mm, thickness_mm, length_mm, width_mm
     FROM coins WHERE id = ?`,
    [CHERVONETS_ID]
  );
  if (rows.length === 0) {
    console.error("Монета с id", CHERVONETS_ID, "не найдена в БД.");
    await conn.end();
    process.exit(1);
  }

  const template = rows[0];
  const [year1975, cat1975] = YEAR_TO_CATALOG[0];

  // 1) Обновить текущую монету на 1975 год и каталожный номер 3213-0002
  await conn.execute(
    `UPDATE coins SET release_date = ?, catalog_number = ?, catalog_suffix = NULL WHERE id = ?`,
    [`${year1975}-01-01`, cat1975, CHERVONETS_ID]
  );
  console.log("✓ id", CHERVONETS_ID, "→ год", year1975, ", каталог", cat1975);

  // 2) Вставить 7 монет (1976–1982), копируя данные с шаблона; картинки те же
  const insertCols = Object.keys(template).filter((k) => k !== "id");
  const placeholders = insertCols.map(() => "?").join(", ");
  const sql = `INSERT INTO coins (${insertCols.join(", ")}) VALUES (${placeholders})`;

  for (let i = 1; i < YEAR_TO_CATALOG.length; i++) {
    const [year, catalogNumber] = YEAR_TO_CATALOG[i];
    const values = insertCols.map((col) => {
      if (col === "release_date") return `${year}-01-01`;
      if (col === "catalog_number") return catalogNumber;
      if (col === "catalog_suffix") return null;
      const v = template[col];
      return v === undefined || v === null ? null : v;
    });
    await conn.execute(sql, values);
    console.log("✓ добавлена монета: год", year, ", каталог", catalogNumber);
  }

  await conn.end();
  console.log("Готово. Запустите экспорт и билд: npm run build");
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
