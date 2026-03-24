/**
 * Uncle Sam 2 oz cast bar: дубликат 6406 (вторая URL на Germania) удаляем из БД.
 * Меняем местами содержимое obv/rev, переименовываем webp как у Pink October (6416): 2024-…-bar-obv/rev/box/cert.
 * Проставляем release_date 2024 и is_rectangular = 1 для id 6405.
 *
 * Запуск из omonete-app: node scripts/uncle-sam-bar-dedupe-swap-rename-rectangular.js
 * Затем: npm run data:export
 */
require("dotenv").config({ path: ".env" });
const mysql = require("mysql2/promise");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const FOREIGN_DIR = path.join(__dirname, "..", "public", "image", "coins", "foreign");
const BASE = path.join(__dirname, "..");

const KEEP_ID = 6405;
const DELETE_ID = 6406;

const OLD_BASE = "americana-uncle-sam-2oz-cast-bar";
const NEW_BASE = "2024-americana-uncle-sam-2oz-bar";

const OLD = {
  obv: `${OLD_BASE}-obv.webp`,
  rev: `${OLD_BASE}-rev.webp`,
  box: `${OLD_BASE}-box.webp`,
  cert: `${OLD_BASE}-cert.webp`,
};
const NEW = {
  obv: `${NEW_BASE}-obv.webp`,
  rev: `${NEW_BASE}-rev.webp`,
  box: `${NEW_BASE}-box.webp`,
  cert: `${NEW_BASE}-cert.webp`,
};

function swapObvRevOnDisk() {
  const obv = path.join(FOREIGN_DIR, OLD.obv);
  const rev = path.join(FOREIGN_DIR, OLD.rev);
  if (!fs.existsSync(obv) || !fs.existsSync(rev)) {
    console.error("Нет файлов obv/rev для обмена:", OLD.obv, OLD.rev);
    process.exit(1);
  }
  const tmp = path.join(FOREIGN_DIR, `.swap-${crypto.randomBytes(8).toString("hex")}-${OLD.obv}`);
  fs.renameSync(obv, tmp);
  fs.renameSync(rev, obv);
  fs.renameSync(tmp, rev);
  console.log("✓ Содержимое obv ↔ rev обменено:", OLD.obv, "↔", OLD.rev);
}

function renameAll() {
  const pairs = [
    [OLD.obv, NEW.obv],
    [OLD.rev, NEW.rev],
    [OLD.box, NEW.box],
    [OLD.cert, NEW.cert],
  ];
  for (const [from, to] of pairs) {
    const a = path.join(FOREIGN_DIR, from);
    const b = path.join(FOREIGN_DIR, to);
    if (!fs.existsSync(a)) {
      console.error("Нет файла:", from);
      process.exit(1);
    }
    if (fs.existsSync(b)) {
      console.error("Целевой файл уже существует, прерываю:", to);
      process.exit(1);
    }
    fs.renameSync(a, b);
    console.log("✓", from, "→", to);
  }
}

function parseDatabaseUrl(url) {
  const m = url.match(/mysql:\/\/([^:]+):([^@]+)@([^:]+):(\d+)\/(.+)/);
  if (!m) return null;
  const [, user, password, host, port, database] = m;
  return { user, password, host, port: parseInt(port, 10), database };
}

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL не задан");
    process.exit(1);
  }
  const cfg = parseDatabaseUrl(url);
  if (!cfg) {
    console.error("Неверный формат DATABASE_URL");
    process.exit(1);
  }

  swapObvRevOnDisk();
  renameAll();

  const conn = await mysql.createConnection(cfg);

  const [keepRows] = await conn.execute("SELECT id, title FROM coins WHERE id = ?", [KEEP_ID]);
  if (keepRows.length === 0) {
    console.error("Монета id=" + KEEP_ID + " не найдена в БД");
    await conn.end();
    process.exit(1);
  }

  const prefix = "/image/coins/foreign/";
  const imageObverse = prefix + NEW.obv;
  const imageReverse = prefix + NEW.rev;
  const imageBox = prefix + NEW.box;
  const imageCertificate = prefix + NEW.cert;

  try {
    await conn.execute(
      `UPDATE coins SET
        image_obverse = ?,
        image_reverse = ?,
        image_box = ?,
        image_certificate = ?,
        release_date = ?,
        is_rectangular = 1
      WHERE id = ?`,
      [imageObverse, imageReverse, imageBox, imageCertificate, "2024-01-01", KEEP_ID]
    );
    console.log("✓ Обновлена запись id=" + KEEP_ID + " (картинки, 2024, is_rectangular=1)");
  } catch (e) {
    if (/is_rectangular/.test(String(e.message))) {
      await conn.execute(
        `UPDATE coins SET
          image_obverse = ?,
          image_reverse = ?,
          image_box = ?,
          image_certificate = ?,
          release_date = ?
        WHERE id = ?`,
        [imageObverse, imageReverse, imageBox, imageCertificate, "2024-01-01", KEEP_ID]
      );
      console.log("✓ Обновлена запись id=" + KEEP_ID + " (без колонки is_rectangular — добавьте через migrate-rectangular-flag.js)");
    } else {
      throw e;
    }
  }

  const [delRows] = await conn.execute("SELECT id, title FROM coins WHERE id = ?", [DELETE_ID]);
  if (delRows.length > 0) {
    await conn.execute("DELETE FROM coins WHERE id = ?", [DELETE_ID]);
    console.log("✓ Удалён дубликат id=" + DELETE_ID);
  } else {
    console.log("(id=" + DELETE_ID + " уже отсутствует в БД)");
  }

  await conn.end();

  const jsonPath = path.join(BASE, "public", "data", "coins", DELETE_ID + ".json");
  if (fs.existsSync(jsonPath)) {
    fs.unlinkSync(jsonPath);
    console.log("✓ Удалён", path.relative(BASE, jsonPath));
  }

  console.log("Дальше: npm run data:export");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
