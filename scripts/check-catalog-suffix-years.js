/**
 * Проверка монет с одним базовым каталожным номером и разными суффиксами.
 * Группирует по базе (5111-0178 → 5111-0178, 5111-0178-10, 5111-0178-26),
 * выводит id, catalog_number, catalog_suffix, release_date, вычисленный год.
 *
 * Запуск: node scripts/check-catalog-suffix-years.js
 */
require("dotenv").config({ path: ".env" });
const mysql = require("mysql2/promise");

function baseCatalogNumber(catNum) {
  if (!catNum || typeof catNum !== "string") return null;
  return String(catNum).trim().replace(/-\d{2}$/, "") || null;
}

function yearFromSuffix(suffix) {
  if (suffix == null || String(suffix).length !== 2) return null;
  const yy = parseInt(String(suffix), 10);
  if (Number.isNaN(yy) || yy < 0 || yy > 99) return null;
  return 2000 + yy;
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

  let rows;
  try {
    [rows] = await conn.execute(
      `SELECT id, catalog_number, catalog_suffix, release_date, title, face_value
       FROM coins
       WHERE catalog_number IS NOT NULL AND TRIM(catalog_number) != ''
       ORDER BY catalog_number`
    );
  } catch (e) {
    if (e.code === "ER_BAD_FIELD_ERROR" && /catalog_suffix/.test(e.message)) {
      [rows] = await conn.execute(
        `SELECT id, catalog_number, release_date, title, face_value
         FROM coins
         WHERE catalog_number IS NOT NULL AND TRIM(catalog_number) != ''
         ORDER BY catalog_number`
      );
      rows.forEach((r) => { r.catalog_suffix = null; });
    } else throw e;
  }

  function suffixFromCatalogNumber(catNum) {
    if (!catNum || typeof catNum !== "string") return null;
    const m = String(catNum).trim().match(/-(\d{2})$/);
    return m ? m[1] : null;
  }

  const byBase = new Map();
  for (const r of rows) {
    const base = baseCatalogNumber(r.catalog_number);
    if (!base) continue;
    const suffix = r.catalog_suffix ?? suffixFromCatalogNumber(r.catalog_number);
    if (!byBase.has(base)) byBase.set(base, []);
    const releaseYear = r.release_date ? new Date(r.release_date).getFullYear() : null;
    const yearFromCat = yearFromSuffix(suffix);
    const displayYear = yearFromCat ?? releaseYear ?? "?";
    byBase.get(base).push({
      id: r.id,
      catalog_number: r.catalog_number,
      catalog_suffix: suffix,
      release_date: r.release_date,
      releaseYear,
      displayYear,
      title: (r.title || "").slice(0, 45),
      face_value: r.face_value,
    });
  }

  // только базы, у которых больше одной записи или есть и с суффиксом, и без
  const groups = [];
  for (const [base, list] of byBase.entries()) {
  const withSuffix = list.filter((c) => c.catalog_suffix != null && c.catalog_suffix !== "");
  const withoutSuffix = list.filter((c) => !c.catalog_suffix);
    if (list.length > 1 || (withSuffix.length && withoutSuffix.length)) {
      groups.push({ base, list, withSuffix, withoutSuffix });
    }
  }

  console.log("--- Базы с несколькими каталожными номерами или с суффиксами ---\n");
  for (const { base, list } of groups) {
    console.log("Базовый номер:", base, "| записей:", list.length);
    for (const c of list) {
      const ok = c.catalog_suffix ? c.displayYear === yearFromSuffix(c.catalog_suffix) : "n/a";
      console.log(
        "  id:",
        c.id,
        "| catalog:",
        c.catalog_number,
        "| suffix:",
        c.catalog_suffix ?? "—",
        "| release_date:",
        c.release_date ?? "—",
        "| год на сайте:",
        c.displayYear,
        "|",
        c.title
      );
    }
    console.log("");
  }

  // Отдельно: монета 2518
  const id2518 = rows.find((r) => String(r.id) === "2518");
  if (id2518) {
    console.log("--- Монета id 2518 ---");
    console.log("  catalog_number:", id2518.catalog_number);
    console.log("  catalog_suffix:", id2518.catalog_suffix ?? "—");
    console.log("  release_date:", id2518.release_date);
    console.log("  title:", id2518.title?.slice(0, 50));
    const y = yearFromSuffix(id2518.catalog_suffix) ?? (id2518.release_date ? new Date(id2518.release_date).getFullYear() : null);
    console.log("  → год на сайте:", y);
  }

  await conn.end();
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
