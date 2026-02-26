/**
 * Импорт статей дворов из mint-articles.json в таблицу mint_articles (MySQL Reg.ru).
 * 1) Создайте таблицу: выполните scripts/mint_articles_schema.sql в phpMyAdmin.
 * 2) Получите mint-articles.json: запустите dev-сервер и откройте в браузере /api/mint-articles-export, сохраните как mint-articles.json в корень проекта. Или сгенерируйте JSON иначе.
 * 3) Запуск: node scripts/import-mint-articles-to-db.js
 */
require("dotenv").config({ path: ".env" });
const mysql = require("mysql2/promise");
const fs = require("fs");
const path = require("path");

const JSON_PATH = path.join(__dirname, "..", "mint-articles.json");

async function run() {
  if (!fs.existsSync(JSON_PATH)) {
    console.error("Файл не найден:", JSON_PATH);
    console.error("Получите его: запустите npm run dev, откройте http://localhost:3000/api/mint-articles-export и сохраните ответ как mint-articles.json в корень проекта.");
    process.exit(1);
  }
  const data = JSON.parse(fs.readFileSync(JSON_PATH, "utf8"));
  const entries = Object.entries(data);
  if (entries.length === 0) {
    console.error("mint-articles.json пуст.");
    process.exit(1);
  }

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

  const insertSql = `INSERT INTO mint_articles (slug, name, short_name, country, logo_url, gallery_images, sections, facts, famous_coins, sources_line)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON DUPLICATE KEY UPDATE
    name = VALUES(name), short_name = VALUES(short_name), country = VALUES(country), logo_url = VALUES(logo_url),
    gallery_images = VALUES(gallery_images), sections = VALUES(sections), facts = VALUES(facts),
    famous_coins = VALUES(famous_coins), sources_line = VALUES(sources_line)`;

  let count = 0;
  for (const [slug, art] of entries) {
    if (!art || typeof art !== "object") continue;
    const name = art.name ?? "";
    const shortName = art.shortName ?? "";
    const country = art.country ?? null;
    const logoUrl = art.logoUrl ?? "";
    const galleryImages = art.galleryImages ? JSON.stringify(art.galleryImages) : null;
    const sections = art.sections ? JSON.stringify(art.sections) : "[]";
    const facts = art.facts ? JSON.stringify(art.facts) : null;
    const famousCoins = art.famousCoins ? JSON.stringify(art.famousCoins) : null;
    const sourcesLine = art.sourcesLine ?? null;
    await conn.execute(insertSql, [
      slug,
      name,
      shortName,
      country,
      logoUrl,
      galleryImages,
      sections,
      facts,
      famousCoins,
      sourcesLine,
    ]);
    count++;
  }
  await conn.end();
  console.log("✓ Импортировано статей:", count);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
