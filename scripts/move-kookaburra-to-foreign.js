/**
 * Переносит все картинки из папки kookaburra в foreign и обновляет пути в БД.
 * После: пути /image/coins/kookaburra/ → /image/coins/foreign/
 *
 * Запуск: node scripts/move-kookaburra-to-foreign.js
 *         node scripts/move-kookaburra-to-foreign.js --dry
 */

/* eslint-disable no-console */

require("dotenv").config({ path: ".env" });
const fs = require("fs");
const path = require("path");
const mysql = require("mysql2/promise");

const ROOT = path.join(__dirname, "..", "public", "image", "coins");
const KOOKABURRA_DIR = path.join(ROOT, "kookaburra");
const FOREIGN_DIR = path.join(ROOT, "foreign");
const PATH_OLD = "/image/coins/kookaburra/";
const PATH_NEW = "/image/coins/foreign/";

async function main() {
  const dryRun = process.argv.includes("--dry");

  if (!fs.existsSync(KOOKABURRA_DIR)) {
    console.log("Папка kookaburra не найдена.");
    return;
  }

  const files = fs.readdirSync(KOOKABURRA_DIR);
  console.log("Файлов в kookaburra:", files.length);

  if (!dryRun && files.length > 0) {
    for (const f of files) {
      const src = path.join(KOOKABURRA_DIR, f);
      const dest = path.join(FOREIGN_DIR, f);
      if (fs.statSync(src).isFile()) {
        fs.copyFileSync(src, dest);
      }
    }
    console.log("Скопировано в foreign:", files.filter((f) => fs.statSync(path.join(KOOKABURRA_DIR, f)).isFile()).length);
    // Удаляем файлы из kookaburra (папку оставляем пустой или удалим в конце)
    for (const f of files) {
      const src = path.join(KOOKABURRA_DIR, f);
      if (fs.statSync(src).isFile()) fs.unlinkSync(src);
    }
  }

  const url = process.env.DATABASE_URL;
  if (!url) {
    console.log("DATABASE_URL не задан — обновление БД пропущено.");
    return;
  }
  const m = url.match(/mysql:\/\/([^:]+):([^@]+)@([^:]+):(\d+)\/(.+)/);
  const conn = await mysql.createConnection({
    host: m[3], port: parseInt(m[4], 10), user: m[1], password: m[2], database: m[5],
  });

  const [rows] = await conn.execute(
    `SELECT id, image_obverse, image_reverse, image_box, image_certificate FROM coins
     WHERE image_obverse LIKE '%kookaburra/%' OR image_reverse LIKE '%kookaburra/%'
        OR (image_box IS NOT NULL AND image_box LIKE '%kookaburra/%')
        OR (image_certificate IS NOT NULL AND image_certificate LIKE '%kookaburra/%')`
  );

  console.log("Записей в БД с путями kookaburra/:", rows.length);

  for (const r of rows) {
    const updates = {};
    const repl = (v) => (v || "").replace(PATH_OLD, PATH_NEW);
    if (r.image_obverse && r.image_obverse.includes("kookaburra/")) updates.image_obverse = repl(r.image_obverse);
    if (r.image_reverse && r.image_reverse.includes("kookaburra/")) updates.image_reverse = repl(r.image_reverse);
    if (r.image_box && r.image_box.includes("kookaburra/")) updates.image_box = repl(r.image_box);
    if (r.image_certificate && r.image_certificate.includes("kookaburra/")) updates.image_certificate = repl(r.image_certificate);
    if (Object.keys(updates).length === 0) continue;

    const sets = Object.entries(updates).map(([k, v]) => `${k} = ?`).join(", ");
    if (!dryRun) await conn.execute(`UPDATE coins SET ${sets} WHERE id = ?`, [...Object.values(updates), r.id]);
  }

  await conn.end();
  console.log(dryRun ? "[dry] Готово." : "БД обновлена.");
  if (!dryRun) {
    try {
      const remaining = fs.readdirSync(KOOKABURRA_DIR).length;
      if (remaining === 0) {
        fs.rmdirSync(KOOKABURRA_DIR);
        console.log("Папка kookaburra удалена (пустая).");
      }
    } catch (e) {
      console.log("Папку kookaburra не удалось удалить:", e.message);
    }
    console.log("Дальше: npm run data:export:incremental && npm run build");
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
