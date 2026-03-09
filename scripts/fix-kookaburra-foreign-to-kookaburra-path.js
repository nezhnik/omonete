/**
 * Исправляет пути: /image/coins/foreign/kookaburra-* → /image/coins/kookaburra/kookaburra-*
 * Только если целевой файл существует в kookaburra (не трогаем kaa-kaa и др. в foreign).
 *
 * Запуск: node scripts/fix-kookaburra-foreign-to-kookaburra-path.js
 *         node scripts/fix-kookaburra-foreign-to-kookaburra-path.js --dry
 */

/* eslint-disable no-console */

require("dotenv").config({ path: ".env" });
const fs = require("fs");
const path = require("path");
const mysql = require("mysql2/promise");

const FROM = "/image/coins/foreign/kookaburra-";
const TO = "/image/coins/kookaburra/kookaburra-";
const PUBLIC = path.join(__dirname, "..", "public");

function targetExists(relPath) {
  const full = path.join(PUBLIC, relPath);
  return fs.existsSync(full);
}

async function main() {
  const dryRun = process.argv.includes("--dry");
  const url = process.env.DATABASE_URL;
  const m = url.match(/mysql:\/\/([^:]+):([^@]+)@([^:]+):(\d+)\/(.+)/);
  const conn = await mysql.createConnection({
    host: m[3], port: parseInt(m[4], 10), user: m[1], password: m[2], database: m[5],
  });

  const [rows] = await conn.execute(
    `SELECT id, image_obverse, image_reverse, image_box, image_certificate FROM coins
     WHERE image_obverse LIKE '%/foreign/kookaburra-%' OR image_reverse LIKE '%/foreign/kookaburra-%'
        OR (image_box IS NOT NULL AND image_box LIKE '%/foreign/kookaburra-%')
        OR (image_certificate IS NOT NULL AND image_certificate LIKE '%/foreign/kookaburra-%')`
  );

  const repl = (v) => (v || "").replace(FROM, TO);
  let updated = 0;
  let skipped = 0;
  for (const r of rows) {
    const candidates = {};
    if ((r.image_obverse || "").includes("/foreign/kookaburra-")) candidates.image_obverse = repl(r.image_obverse);
    if ((r.image_reverse || "").includes("/foreign/kookaburra-")) candidates.image_reverse = repl(r.image_reverse);
    if (r.image_box && r.image_box.includes("/foreign/kookaburra-")) candidates.image_box = repl(r.image_box);
    if (r.image_certificate && r.image_certificate.includes("/foreign/kookaburra-")) candidates.image_certificate = repl(r.image_certificate);
    if (Object.keys(candidates).length === 0) continue;

    const updates = {};
    for (const [k, newPath] of Object.entries(candidates)) {
      if (targetExists(newPath)) updates[k] = newPath;
    }
    if (Object.keys(updates).length === 0) {
      skipped++;
      continue;
    }

    const sets = Object.entries(updates).map(([k, v]) => `${k} = ?`).join(", ");
    if (!dryRun) await conn.execute(`UPDATE coins SET ${sets} WHERE id = ?`, [...Object.values(updates), r.id]);
    console.log("id=" + r.id, updates);
    updated++;
  }
  if (skipped) console.log("Пропущено (файл в kookaburra отсутствует):", skipped);

  await conn.end();
  console.log((dryRun ? "[dry] " : "") + "Обновлено:", updated);
  if (!dryRun && updated) console.log("Дальше: npm run data:export:incremental && npm run build");
}

main().catch((e) => { console.error(e); process.exit(1); });
