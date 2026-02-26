/**
 * Червонец «Сеятель»: серия «Один червонец Сеятель СССР», тиражи, качество, дворы по списку.
 * 1923 ЛМД; 1975 ЛМД; 1976 ЛМД; 1977 — две монеты ММД и ЛМД; 1979–1982 ММД.
 * Картинки не меняем — пользователь подготовит отдельно.
 *
 * Запуск: node scripts/update-chervonets-series.js
 */
require("dotenv").config({ path: ".env" });
const mysql = require("mysql2/promise");
const path = require("path");

const SERIES = "Один червонец Сеятель СССР";

/** Ленинградский / Московский монетный двор — полные названия для БД */
const MINT_LMD = "Ленинградский монетный двор";
const MINT_MMD = "Московский монетный двор";

/**
 * Записи: год, catalog_number, mint, mint_short, title (если с МД), mintage, mintage_display, quality.
 * 1977 — две строки (ММД и ЛМД).
 */
/** Название: «Один червонец Сеятель год»; для 1977 — с суффиксом (ММД)/(ЛМД). */
const COINS = [
  { year: 1923, catalog_number: "3213-0001", mint: MINT_LMD, mint_short: "ЛМД", title: "Один червонец Сеятель 1923", mintage: 2751000, mintage_display: "до 2 751 000", quality: "АНЦ" },
  { year: 1975, catalog_number: "3213-0002", mint: MINT_LMD, mint_short: "ЛМД", title: "Один червонец Сеятель 1975", mintage: 250000, mintage_display: null, quality: "АНЦ" },
  { year: 1976, catalog_number: "3213-0003", mint: MINT_LMD, mint_short: "ЛМД", title: "Один червонец Сеятель 1976", mintage: 1000000, mintage_display: "до 1 000 000", quality: "АЦ" },
  { year: 1977, catalog_number: "3213-0004", mint: MINT_MMD, mint_short: "ММД", title: "Один червонец Сеятель 1977 (ММД)", mintage: 500000, mintage_display: null, quality: "АНЦ" },
  { year: 1977, catalog_number: "3213-0004-ЛМД", mint: MINT_LMD, mint_short: "ЛМД", title: "Один червонец Сеятель 1977 (ЛМД)", mintage: 500000, mintage_display: null, quality: "АНЦ" },
  { year: 1979, catalog_number: "3213-0006", mint: MINT_MMD, mint_short: "ММД", title: "Один червонец Сеятель 1979", mintage: 1000000, mintage_display: "до 1 000 000", quality: "АНЦ" },
  { year: 1980, catalog_number: "3213-0007", mint: MINT_MMD, mint_short: "ММД", title: "Один червонец Сеятель 1980", mintage: 500000, mintage_display: null, quality: "пруф" },
  { year: 1981, catalog_number: "3213-0009", mint: MINT_MMD, mint_short: "ММД", title: "Один червонец Сеятель 1981", mintage: 500000, mintage_display: null, quality: "АНЦ" },
  { year: 1982, catalog_number: "3213-0010", mint: MINT_MMD, mint_short: "ММД", title: "Один червонец Сеятель 1982", mintage: 500000, mintage_display: null, quality: "АЦ" },
];

async function run() {
  require("dotenv").config({ path: path.join(__dirname, "..", ".env") });
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

  // Шаблон для новых записей: берём монету 4000 (Червонец)
  const [templateRows] = await conn.execute(
    `SELECT id, title, series, country, face_value, release_date, image_urls, catalog_number, catalog_suffix,
     image_obverse, image_reverse, image_box, image_certificate, mint, mint_short, metal, metal_fineness,
     mintage, mintage_display, weight_g, weight_oz, quality, diameter_mm, thickness_mm, length_mm, width_mm
     FROM coins WHERE id = 4000`
  );
  if (templateRows.length === 0) {
    console.error("Монета id 4000 не найдена. Сначала выполните add-chervonets-by-year.js");
    await conn.end();
    process.exit(1);
  }
  const template = templateRows[0];

  // 1) Обновить id 4000 → 1975 ЛМД, серия, тираж, качество
  const first = COINS[1]; // 1975
  await conn.execute(
    `UPDATE coins SET release_date = ?, catalog_number = ?, series = ?, mint = ?, mint_short = ?,
     mintage = ?, mintage_display = ?, quality = ?, title = ? WHERE id = 4000`,
    [`${first.year}-01-01`, first.catalog_number, SERIES, first.mint, first.mint_short,
      first.mintage, first.mintage_display, first.quality, first.title]
  );
  console.log("✓ id 4000 →", first.year, first.mint_short, first.mintage, first.quality);

  // 2) Обновить существующие по catalog_number (1976, 1977 одна, 1979, 1980, 1981, 1982)
  const toUpdate = [
    COINS[2], // 1976
    COINS[3], // 1977 ММД (одна из двух — эту обновим)
    COINS[5], // 1979
    COINS[6], // 1980
    COINS[7], // 1981
    COINS[8], // 1982
  ];
  for (const c of toUpdate) {
    const cat = c.catalog_number;
    const [r] = await conn.execute(
      `SELECT id FROM coins WHERE catalog_number = ? LIMIT 1`,
      [cat]
    );
    if (r.length === 0) {
      console.warn("  пропуск (нет в БД):", c.year, c.catalog_number);
      continue;
    }
    const id = r[0].id;
    await conn.execute(
      `UPDATE coins SET release_date = ?, series = ?, mint = ?, mint_short = ?,
       mintage = ?, mintage_display = ?, quality = ?, title = ? WHERE id = ?`,
      [`${c.year}-01-01`, SERIES, c.mint, c.mint_short,
        c.mintage, c.mintage_display, c.quality, c.title, id]
    );
    console.log("✓ id", id, "→", c.year, c.mint_short, c.mintage, c.quality, c.title);
  }

  // 3) 1977 ЛМД — вставить вторую монету (копия 1977 ММД, но ЛМД и название с (ЛМД))
  const c1977LMD = COINS[4];
  const [row1977] = await conn.execute(`SELECT id FROM coins WHERE catalog_number = '3213-0004' LIMIT 1`);
  if (row1977.length > 0) {
    const [template1977] = await conn.execute(
      `SELECT id, title, series, country, face_value, release_date, image_urls, catalog_number, catalog_suffix,
       image_obverse, image_reverse, image_box, image_certificate, mint, mint_short, metal, metal_fineness,
       mintage, mintage_display, weight_g, weight_oz, quality, diameter_mm, thickness_mm, length_mm, width_mm
       FROM coins WHERE id = ?`,
      [row1977[0].id]
    );
    const t = template1977[0];
    const insertCols = Object.keys(t).filter((k) => k !== "id");
    const placeholders = insertCols.map(() => "?").join(", ");
    const vals = insertCols.map((col) => {
      if (col === "release_date") return "1977-01-01";
      if (col === "catalog_number") return "3213-0004-ЛМД";
      if (col === "series") return SERIES;
      if (col === "mint") return c1977LMD.mint;
      if (col === "mint_short") return c1977LMD.mint_short;
      if (col === "title") return c1977LMD.title;
      if (col === "mintage") return c1977LMD.mintage;
      if (col === "mintage_display") return c1977LMD.mintage_display;
      if (col === "quality") return c1977LMD.quality;
      const v = t[col];
      return v === undefined || v === null ? null : v;
    });
    await conn.execute(`INSERT INTO coins (${insertCols.join(", ")}) VALUES (${placeholders})`, vals);
    console.log("✓ добавлена: 1977 ЛМД, тираж 500 000, АНЦ, «Червонец (ЛМД)»");
  }

  // 4) 1923 ЛМД — вставить (картинки пока с шаблона 4000)
  const c1923 = COINS[0];
  const insertCols = Object.keys(template).filter((k) => k !== "id");
  const placeholders = insertCols.map(() => "?").join(", ");
  const sqlInsert = `INSERT INTO coins (${insertCols.join(", ")}) VALUES (${placeholders})`;
  const vals1923 = insertCols.map((col) => {
    if (col === "release_date") return "1923-01-01";
    if (col === "catalog_number") return c1923.catalog_number;
    if (col === "series") return SERIES;
    if (col === "mint") return c1923.mint;
    if (col === "mint_short") return c1923.mint_short;
    if (col === "title") return c1923.title;
    if (col === "mintage") return c1923.mintage;
    if (col === "mintage_display") return c1923.mintage_display;
    if (col === "quality") return c1923.quality;
    const v = template[col];
    return v === undefined || v === null ? null : v;
  });
  await conn.execute(sqlInsert, vals1923);
  console.log("✓ добавлена: 1923 ЛМД, до 2 751 000, АНЦ");

  await conn.end();
  console.log("Готово. Серия:", SERIES);
  console.log("Картинки оставлены как есть — при необходимости обновите image_obverse/image_reverse. Затем: npm run build");
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
