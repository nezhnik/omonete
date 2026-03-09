/**
 * Убирает "apmex" из имён: файлы apmex-kookaburra-* → kookaburra-*, папка apmex-kookaburra → kookaburra.
 * Обновляет пути в БД (image_obverse, image_reverse, image_box, image_certificate).
 *
 * Запуск: node scripts/rename-apmex-kookaburra-to-kookaburra.js
 *         node scripts/rename-apmex-kookaburra-to-kookaburra.js --dry
 */

/* eslint-disable no-console */

require("dotenv").config({ path: ".env" });
const fs = require("fs");
const path = require("path");
const mysql = require("mysql2/promise");

const ROOT = path.join(__dirname, "..", "public", "image", "coins");
const OLD_DIR = path.join(ROOT, "apmex-kookaburra");
const NEW_DIR = path.join(ROOT, "kookaburra");
const FILE_PREFIX_OLD = "apmex-kookaburra-";
const FILE_PREFIX_NEW = "kookaburra-";
const PATH_OLD = "/image/coins/apmex-kookaburra/";
const PATH_NEW = "/image/coins/kookaburra/";
const PATH_OLD_PREFIX = "/image/coins/apmex-kookaburra/apmex-kookaburra-";
const PATH_NEW_PREFIX = "/image/coins/kookaburra/kookaburra-";

async function main() {
  const dryRun = process.argv.includes("--dry");

  if (!fs.existsSync(OLD_DIR)) {
    console.log("Папка apmex-kookaburra не найдена.");
    return;
  }

  const files = fs.readdirSync(OLD_DIR);
  const toRename = files.filter((f) => f.startsWith(FILE_PREFIX_OLD));
  console.log("Файлов к переименованию (apmex-kookaburra-* → kookaburra-*):", toRename.length);

  if (!dryRun && toRename.length > 0) {
    for (const f of toRename) {
      const newName = FILE_PREFIX_NEW + f.slice(FILE_PREFIX_OLD.length);
      const oldPath = path.join(OLD_DIR, f);
      const newPath = path.join(OLD_DIR, newName);
      if (oldPath !== newPath) fs.renameSync(oldPath, newPath);
    }
  }

  if (fs.existsSync(NEW_DIR)) {
    console.log("Папка kookaburra уже существует (не переименовываем apmex-kookaburra).");
  } else if (!dryRun) {
    fs.renameSync(OLD_DIR, NEW_DIR);
    console.log("Папка переименована: apmex-kookaburra → kookaburra");
  } else {
    console.log("[dry] Будет переименована папка apmex-kookaburra → kookaburra");
  }

  const url = process.env.DATABASE_URL;
  if (!url) {
    console.log("DATABASE_URL не задан — обновление БД пропущено.");
    return;
  }
  const m = url.match(/mysql:\/\/([^:]+):([^@]+)@([^:]+):(\d+)\/(.+)/);
  if (!m) {
    console.log("Неверный DATABASE_URL — обновление БД пропущено.");
    return;
  }

  const conn = await mysql.createConnection({
    host: m[3],
    port: parseInt(m[4], 10),
    user: m[1],
    password: m[2],
    database: m[5],
  });

  const [rows] = await conn.execute(
    `SELECT id, image_obverse, image_reverse, image_box, image_certificate FROM coins
     WHERE image_obverse LIKE '%apmex-kookaburra%' OR image_reverse LIKE '%apmex-kookaburra%'
        OR (image_box IS NOT NULL AND image_box LIKE '%apmex-kookaburra%')
        OR (image_certificate IS NOT NULL AND image_certificate LIKE '%apmex-kookaburra%')`
  );

  console.log("Записей в БД с путями apmex-kookaburra:", rows.length);

  for (const r of rows) {
    const updates = {};
    const replacePath = (v) => {
      if (!v || typeof v !== "string") return v;
      return v
        .replace(PATH_OLD_PREFIX, PATH_NEW_PREFIX)
        .replace(PATH_OLD, PATH_NEW);
    };
    if (r.image_obverse && r.image_obverse.includes("apmex-kookaburra")) updates.image_obverse = replacePath(r.image_obverse);
    if (r.image_reverse && r.image_reverse.includes("apmex-kookaburra")) updates.image_reverse = replacePath(r.image_reverse);
    if (r.image_box && r.image_box.includes("apmex-kookaburra")) updates.image_box = replacePath(r.image_box);
    if (r.image_certificate && r.image_certificate.includes("apmex-kookaburra")) updates.image_certificate = replacePath(r.image_certificate);

    if (Object.keys(updates).length === 0) continue;

    const sets = Object.entries(updates)
      .map(([k, v]) => `${k} = ?`)
      .join(", ");
    const vals = Object.values(updates);
    if (!dryRun) {
      await conn.execute(`UPDATE coins SET ${sets} WHERE id = ?`, [...vals, r.id]);
    }
  }

  await conn.end();
  console.log(dryRun ? "[dry] Готово. Запустите без --dry для применения." : "БД обновлена. Дальше: npm run data:export:incremental && npm run build");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
