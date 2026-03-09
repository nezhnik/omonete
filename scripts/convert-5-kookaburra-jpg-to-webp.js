/**
 * Конвертирует JPG 1995/1997/2008 Kookaburra в webp и обновляет БД.
 * Запуск: node scripts/convert-5-kookaburra-jpg-to-webp.js
 */

/* eslint-disable no-console */

require("dotenv").config({ path: ".env" });
const fs = require("fs");
const path = require("path");
const mysql = require("mysql2/promise");

const FOREIGN_DIR = path.join(__dirname, "..", "public", "image", "coins", "foreign");

const MAP = [
  { id: 5850, obv: "1995-australia-1-oz-silver-kookaburra-bu_10160_Obv.jpg", rev: "1995-australia-1-oz-silver-kookaburra-bu_10160_Rev.jpg", webpObv: "kookaburra-1oz-1995-obv.webp", webpRev: "kookaburra-1oz-1995-rev.webp" },
  { id: 5851, obv: "1995-australia-1-oz-silver-kookaburra-bu_10160_Obv.jpg", rev: "1995-australia-1-oz-silver-kookaburra-bu_10160_Rev.jpg", webpObv: "kookaburra-1oz-1995-obv.webp", webpRev: "kookaburra-1oz-1995-rev.webp" }, // Proof — obv/rev те же
  { id: 5854, obv: "1997-australia-1-oz-silver-kookaburra-bu_10162_Obv.jpg", rev: "1997-australia-1-oz-silver-kookaburra-bu_10162_Rev.jpg", webpObv: "kookaburra-1oz-1997-obv.webp", webpRev: "kookaburra-1oz-1997-rev.webp" },
  { id: 5855, obv: "1997-australia-1-oz-silver-kookaburra-proof_Obv.jpg", rev: "1997-australia-1-oz-silver-kookaburra-proof_rev.jpg", webpObv: "kookaburra-1oz-1997-proof-obv.webp", webpRev: "kookaburra-1oz-1997-proof-rev.webp" },
  { id: 5874, obv: "2008-australia-1-oz-silver-kookaburra-bu_28840_Obv.jpg", rev: "2008-australia-1-oz-silver-kookaburra-bu_28840_Rev.jpg", webpObv: "kookaburra-1oz-2008-obv.webp", webpRev: "kookaburra-1oz-2008-rev.webp" },
];

async function convertWithSharp(srcPath, destPath) {
  const sharp = require("sharp");
  await sharp(srcPath)
    .webp({ quality: 85 })
    .toFile(destPath);
}

async function main() {
  const converted = new Map();
  for (const m of MAP) {
    const obvSrc = path.join(FOREIGN_DIR, m.obv);
    const revSrc = path.join(FOREIGN_DIR, m.rev);
    const obvDest = path.join(FOREIGN_DIR, m.webpObv);
    const revDest = path.join(FOREIGN_DIR, m.webpRev);

    if (!fs.existsSync(obvSrc) || !fs.existsSync(revSrc)) {
      console.log("  Пропуск id=" + m.id + ": нет " + m.obv + " или " + m.rev);
      continue;
    }

    const keyObv = m.webpObv;
    const keyRev = m.webpRev;
    if (!converted.has(keyObv)) {
      await convertWithSharp(obvSrc, obvDest);
      converted.set(keyObv, true);
      console.log("  webp:", m.webpObv);
    }
    if (!converted.has(keyRev)) {
      await convertWithSharp(revSrc, revDest);
      converted.set(keyRev, true);
      console.log("  webp:", m.webpRev);
    }
  }

  const url = process.env.DATABASE_URL;
  const m = url.match(/mysql:\/\/([^:]+):([^@]+)@([^:]+):(\d+)\/(.+)/);
  const conn = await mysql.createConnection({
    host: m[3], port: parseInt(m[4], 10), user: m[1], password: m[2], database: m[5],
  });

  const pathsByEntry = new Map();
  for (const e of MAP) {
    pathsByEntry.set(e.id, {
      obv: `/image/coins/foreign/${e.webpObv}`,
      rev: `/image/coins/foreign/${e.webpRev}`,
    });
  }

  for (const [id, p] of pathsByEntry) {
    await conn.execute("UPDATE coins SET image_obverse = ?, image_reverse = ? WHERE id = ?", [p.obv, p.rev, id]);
    console.log("  БД обновлена id=" + id);
  }

  await conn.end();
  console.log("\nГотово. Конвертировано", converted.size, "файлов, обновлено 5 монет.");
}

main().catch((e) => { console.error(e); process.exit(1); });
