/**
 * Правка страны для соверенов.
 *
 * Правило:
 * - Если монета-соверен сейчас имеет country = "Австралия",
 *   и в названии (title или title_en) НЕТ слов "Australia" или "Perth",
 *   то считаем, что это британский соверен и ставим country = "Великобритания".
 * - Если в названии есть "Australia" или "Perth" — оставляем "Австралия".
 *
 * Фокус только на соверены:
 * - title / title_en / series содержат "Sovereign".
 *
 * Запуск: node scripts/fix-sovereign-country.js
 */

require("dotenv").config({ path: ".env" });
const mysql = require("mysql2/promise");

function parseDatabaseUrl(url) {
  const m = url.match(/mysql:\/\/([^:]+):([^@]+)@([^:]+):(\d+)\/(.+)/);
  if (!m) throw new Error("Неверный формат DATABASE_URL");
  const [, user, password, host, port, database] = m;
  return { user, password, host, port: parseInt(port, 10), database };
}

function isAustralianByTitle(title, titleEn) {
  const src = [title, titleEn].filter(Boolean).join(" ").toLowerCase();
  if (!src) return false;
  return src.includes("australia") || src.includes("perth");
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
    // Берём только монеты с country = "Австралия" и признаком Sovereign в названии/серии
    const [rows] = await conn.execute(
      `
      SELECT id, title, title_en, series, country
      FROM coins
      WHERE country = "Австралия"
        AND (
          title LIKE "%Sovereign%"
          OR title_en LIKE "%Sovereign%"
          OR series LIKE "%Sovereign%"
        )
      ORDER BY id
      `
    );

    if (!rows.length) {
      console.log("Соверены с country = \"Австралия\" не найдены — править нечего.");
      await conn.end();
      return;
    }

    const keepAustralia = [];
    const toUk = [];

    for (const r of rows) {
      const keepAu = isAustralianByTitle(r.title, r.title_en);
      if (keepAu) {
        keepAustralia.push(r);
      } else {
        toUk.push(r);
      }
    }

    console.log(`Найдено соверенов с country = "Австралия": ${rows.length}`);
    console.log(`Останутся Австралия (в названии есть Australia/Perth): ${keepAustralia.length}`);
    console.log(`Будут переведены на Великобритания: ${toUk.length}`);

    if (toUk.length === 0) {
      console.log("Ни одной монеты для перевода на Великобритания не найдено.");
      await conn.end();
      return;
    }

    const idsToUk = toUk.map((r) => r.id);
    const placeholders = idsToUk.map(() => "?").join(",");
    const [res] = await conn.execute(
      `UPDATE coins SET country = "Великобритания" WHERE id IN (${placeholders})`,
      idsToUk
    );
    console.log(`✓ Обновлено строк в БД: ${res.affectedRows || 0}`);
  } finally {
    await conn.end();
  }
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});

