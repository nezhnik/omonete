/**
 * Создаёт таблицу mints (если нет) и вставляет/обновляет дворы с логотипами.
 * СПМД, ММД, ЛМД — с логотипами spmd.webp, mmd.webp, lmd.webp.
 * Запуск: node scripts/ensure-mints-table.js
 */
require("dotenv").config({ path: ".env" });
const mysql = require("mysql2/promise");

const MINTS = [
  {
    name: "Санкт-Петербургский монетный двор",
    slug: "spmd",
    logo_url: "/image/Mints/spmd.webp",
    country: "Россия",
  },
  {
    name: "Московский монетный двор",
    slug: "mmd",
    logo_url: "/image/Mints/mmd.webp",
    country: "Россия",
  },
  {
    name: "Ленинградский монетный двор",
    slug: "lmd",
    logo_url: "/image/Mints/lmd.webp",
    country: "Россия",
  },
];

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

  await conn.execute(`
    CREATE TABLE IF NOT EXISTS mints (
      id INT AUTO_INCREMENT PRIMARY KEY,
      name VARCHAR(255) NOT NULL COMMENT 'Каноническое название (совпадает с coins.mint)',
      slug VARCHAR(64) NOT NULL COMMENT 'URL-идентификатор: spmd, mmd, lmd',
      logo_url VARCHAR(512) DEFAULT NULL COMMENT 'Путь к логотипу',
      country VARCHAR(100) DEFAULT NULL,
      UNIQUE KEY uq_mints_name (name),
      UNIQUE KEY uq_mints_slug (slug)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  console.log("✓ Таблица mints готова");

  for (const row of MINTS) {
    await conn.execute(
      `INSERT INTO mints (name, slug, logo_url, country) VALUES (?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE logo_url = COALESCE(VALUES(logo_url), logo_url), country = VALUES(country)`,
      [row.name, row.slug, row.logo_url, row.country]
    );
    console.log("  ", row.slug, row.logo_url || "(без лого)");
  }

  await conn.end();
  console.log("Готово. Логотип: public/image/Mints/spmd.png → скрипт convert-mints-to-webp.js создаёт .webp");
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
