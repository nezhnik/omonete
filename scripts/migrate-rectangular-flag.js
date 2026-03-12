/**
 * Миграция: перенос признака прямоугольной монеты в БД.
 *
 * Делает три вещи:
 * 1) Проверяет наличие колонки coins.is_rectangular, при отсутствии — добавляет (TINYINT(1) NOT NULL DEFAULT 0).
 * 2) Считывает текущие правила определения прямоугольных монет:
 *    - rectangular-coins.json (catalog_number base)
 *    - rectangular-coin-ids.json (список id)
 *    - длина/ширина (length_mm, width_mm) — если обе заданы, считаем монету прямоугольной
 * 3) Проставляет is_rectangular = 1 для всех монет, которые по этим правилам считаются прямоугольными.
 *
 * Запуск: node scripts/migrate-rectangular-flag.js
 */

require("dotenv").config({ path: ".env" });
const mysql = require("mysql2/promise");
const fs = require("fs");
const path = require("path");

function parseDatabaseUrl(url) {
  const m = url.match(/mysql:\/\/([^:]+):([^@]+)@([^:]+):(\d+)\/(.+)/);
  if (!m) throw new Error("Неверный формат DATABASE_URL");
  const [, user, password, host, port, database] = m;
  return { user, password, host, port: parseInt(port, 10), database };
}

/** Монеты с квадратной/прямоугольной формой: catalog_number из rectangular-coins.json (сопоставляем по base). */
function getRectangularCatalogBases() {
  try {
    const p = path.join(__dirname, "..", "rectangular-coins.json");
    const arr = JSON.parse(fs.readFileSync(p, "utf8"));
    return Array.isArray(arr) ? arr.map((x) => String(x).trim()).filter(Boolean) : [];
  } catch {
    return [];
  }
}

/** Прямоугольные по id (иностранные, напр. Stranger Things Season 1–4). */
function getRectangularCoinIds() {
  try {
    const p = path.join(__dirname, "..", "rectangular-coin-ids.json");
    const arr = JSON.parse(fs.readFileSync(p, "utf8"));
    return Array.isArray(arr) ? arr.map((x) => String(x).trim()).filter(Boolean) : [];
  } catch {
    return [];
  }
}

function isRectangularCoin(catalogNumber, rectangularBases, rectangularIds, id, lengthMm, widthMm) {
  if (id && rectangularIds.length > 0 && rectangularIds.includes(String(id))) return true;
  const hasLen = lengthMm != null && String(lengthMm).trim() !== "";
  const hasWid = widthMm != null && String(widthMm).trim() !== "";
  if (hasLen && hasWid) return true;
  if (!catalogNumber || rectangularBases.length === 0) return false;
  const cat = String(catalogNumber).trim();
  return rectangularBases.some((base) => cat === base || cat.startsWith(base + "-"));
}

async function run() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL не задан в .env");
    process.exit(1);
  }
  const connConfig = parseDatabaseUrl(url);
  const conn = await mysql.createConnection(connConfig);

  try {
    // 1. Проверяем/добавляем колонку is_rectangular
    let hasColumn = true;
    try {
      // Если колонки нет — получим ER_BAD_FIELD_ERROR
      await conn.execute("SELECT is_rectangular FROM coins LIMIT 1");
    } catch (e) {
      if (e.code === "ER_BAD_FIELD_ERROR") {
        hasColumn = false;
      } else {
        throw e;
      }
    }

    if (!hasColumn) {
      console.log("Колонка is_rectangular не найдена, добавляю...");
      await conn.execute(
        "ALTER TABLE coins ADD COLUMN is_rectangular TINYINT(1) NOT NULL DEFAULT 0"
      );
      console.log("✓ Колонка is_rectangular добавлена");
    }

    // 2. Читаем текущие правила и монеты
    const rectangularBases = getRectangularCatalogBases();
    const rectangularIds = getRectangularCoinIds();

    console.log(
      "Используются правила прямоугольности:",
      "catalog bases =", rectangularBases.length,
      ", id =", rectangularIds.length
    );

    const [rows] = await conn.execute(
      "SELECT id, catalog_number, length_mm, width_mm, is_rectangular FROM coins"
    );

    const idsToSet = [];
    for (const r of rows) {
      // Уже отмеченные не трогаем
      if (r.is_rectangular === 1) continue;
      if (isRectangularCoin(r.catalog_number, rectangularBases, rectangularIds, r.id, r.length_mm, r.width_mm)) {
        idsToSet.push(r.id);
      }
    }

    if (idsToSet.length === 0) {
      console.log("Прямоугольных монет для обновления не найдено (все уже помечены или списки пустые).");
      await conn.end();
      return;
    }

    // 3. Проставляем is_rectangular = 1 для найденных id
    const placeholders = idsToSet.map(() => "?").join(",");
    const sql = `UPDATE coins SET is_rectangular = 1 WHERE id IN (${placeholders})`;
    const [result] = await conn.execute(sql, idsToSet);
    console.log(
      `✓ Обновлено монет: ${result.affectedRows || 0} (из ${idsToSet.length} прямоугольных по правилам).`
    );
  } finally {
    await conn.end();
  }
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});

