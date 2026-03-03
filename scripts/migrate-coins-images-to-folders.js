/**
 * Разделяет изображения монет по папкам: ru/ (российские) и foreign/ (иностранные).
 * 1. Создаёт public/image/coins/ru/ и public/image/coins/foreign/
 * 2. Перемещает все существующие .webp из coins/ в coins/ru/ (сейчас все — российские)
 * 3. Обновляет в БД пути image_obverse и image_reverse
 *
 * Запуск: node scripts/migrate-coins-images-to-folders.js [--dry-run]
 */
require("dotenv").config({ path: ".env" });
const fs = require("fs");
const path = require("path");
const mysql = require("mysql2/promise");

const COINS_DIR = path.join(__dirname, "..", "public", "image", "coins");
const RU_DIR = path.join(COINS_DIR, "ru");
const FOREIGN_DIR = path.join(COINS_DIR, "foreign");
const DRY_RUN = process.argv.includes("--dry-run");

async function run() {
  if (DRY_RUN) console.log("Режим --dry-run: изменения не сохраняются.\n");

  // 1. Создаём папки
  if (!DRY_RUN) {
    if (!fs.existsSync(RU_DIR)) fs.mkdirSync(RU_DIR, { recursive: true });
    if (!fs.existsSync(FOREIGN_DIR)) fs.mkdirSync(FOREIGN_DIR, { recursive: true });
    console.log("✓ Папки ru/ и foreign/ созданы");
  } else {
    console.log("Создал бы папки ru/ и foreign/");
  }

  // 2. Перемещаем файлы из coins/ в coins/ru/ (только в корне coins/, не в подпапках)
  if (!fs.existsSync(COINS_DIR)) {
    console.log("Папка public/image/coins не найдена.");
    return;
  }

  const entries = fs.readdirSync(COINS_DIR, { withFileTypes: true });
  const toMove = entries.filter(
    (e) =>
      e.isFile() &&
      !e.name.startsWith(".") &&
      (e.name.endsWith(".webp") || e.name.endsWith(".png"))
  );
  let moved = 0;
  for (const e of toMove) {
    const src = path.join(COINS_DIR, e.name);
    const dst = path.join(RU_DIR, e.name);
    if (!DRY_RUN) {
      fs.renameSync(src, dst);
      moved++;
    }
  }
  if (DRY_RUN) {
    console.log("Переместил бы", toMove.length, "файлов в ru/");
  } else {
    console.log("✓ Перемещено", moved, "файлов в ru/");
  }

  // 3. Обновляем БД
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.log("DATABASE_URL не задан — пропуск обновления БД.");
    return;
  }
  const m = url.match(/mysql:\/\/([^:]+):([^@]+)@([^:]+):(\d+)\/(.+)/);
  if (!m) {
    console.log("Неверный формат DATABASE_URL.");
    return;
  }
  const [, user, password, host, port, database] = m;
  const conn = await mysql.createConnection({
    host,
    port: parseInt(port, 10),
    user,
    password,
    database,
  });

  if (!DRY_RUN) {
    const [obv] = await conn.execute(
      `UPDATE coins SET image_obverse = REPLACE(image_obverse, '/image/coins/', '/image/coins/ru/')
       WHERE image_obverse LIKE '/image/coins/%' AND image_obverse NOT LIKE '/image/coins/ru/%' AND image_obverse NOT LIKE '/image/coins/foreign/%'`
    );
    const [rev] = await conn.execute(
      `UPDATE coins SET image_reverse = REPLACE(image_reverse, '/image/coins/', '/image/coins/ru/')
       WHERE image_reverse LIKE '/image/coins/%' AND image_reverse NOT LIKE '/image/coins/ru/%' AND image_reverse NOT LIKE '/image/coins/foreign/%'`
    );
    console.log("✓ БД: обновлено путей image_obverse:", obv.affectedRows, ", image_reverse:", rev.affectedRows);
  } else {
    const [c] = await conn.execute(
      `SELECT COUNT(*) AS n FROM coins WHERE image_obverse LIKE '/image/coins/%' AND image_obverse NOT LIKE '/image/coins/ru/%'`
    );
    console.log("Обновил бы ~", c[0]?.n ?? 0, "записей в БД");
  }

  await conn.end();
  console.log("\nГотово. Дальше: npm run data:export && npm run build");
  console.log("Иностранные монеты — класть изображения в public/image/coins/foreign/ и указывать пути /image/coins/foreign/...");
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
