/**
 * PAMP-only: меняет местами содержимое пар webp на диске (тройное rename), как у Germania WMF.
 * Пути в БД не меняются — по-прежнему *-obv.webp и *-rev.webp.
 *
 * — Если у монеты заполнены оба image_blister_obverse и image_blister_reverse:
 *   меняются только файлы *-blister-obv.webp ↔ *-blister-rev.webp.
 * — Иначе: *-obv.webp ↔ *-rev.webp (основная пара слитка/монеты без блистерной пары в БД).
 *
 * Упаковка (box, certificate, packaging) не затрагивается.
 *
 *   node scripts/pamp-swap-obv-rev-webp-files.js
 */
require("dotenv").config({ path: ".env" });
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const mysql = require("mysql2/promise");

const FOREIGN_DIR = path.join(__dirname, "..", "public", "image", "coins", "foreign");

/** Не трогать (уже совпадают с задумкой сайта / редактор). */
const SKIP_COIN_IDS = new Set([6802, 6803]);

function getConfig() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL не задан");
  const m = url.match(/mysql:\/\/([^:]+):([^@]+)@([^:]+):(\d+)\/(.+)/);
  if (!m) throw new Error("Неверный формат DATABASE_URL");
  const [, user, password, host, port, database] = m;
  return { host, port: Number(port), user, password, database };
}

/** Базовое имя файла в foreign/ из пути вида /image/coins/foreign/foo.webp */
function foreignBasename(webPath) {
  if (!webPath || typeof webPath !== "string") return null;
  const s = webPath.trim();
  const idx = s.indexOf("/foreign/");
  if (idx === -1) return null;
  const rest = s.slice(idx + "/foreign/".length).split("/").pop();
  if (!rest || !/\.webp$/i.test(rest) || rest.includes("..")) return null;
  return rest;
}

function swapPair(obvBase, revBase, label) {
  const obv = path.join(FOREIGN_DIR, obvBase);
  const rev = path.join(FOREIGN_DIR, revBase);
  if (!fs.existsSync(obv) || !fs.existsSync(rev)) {
    console.warn("Пропуск (нет файлов на диске):", label, obvBase, "+", revBase);
    return false;
  }
  const tmp = path.join(FOREIGN_DIR, `.swap-${crypto.randomBytes(8).toString("hex")}-${obvBase}`);
  fs.renameSync(obv, tmp);
  fs.renameSync(rev, obv);
  fs.renameSync(tmp, rev);
  console.log("OK:", label, obvBase, "↔", revBase);
  return true;
}

async function main() {
  if (!fs.existsSync(FOREIGN_DIR)) {
    console.error("Нет каталога:", FOREIGN_DIR);
    process.exit(1);
  }

  const conn = await mysql.createConnection(getConfig());
  try {
    const [rows] = await conn.execute(
      `SELECT id, image_obverse, image_reverse, image_blister_obverse, image_blister_reverse
       FROM coins
       WHERE source_url IS NOT NULL AND source_url LIKE '%pamp.com%'`
    );

    let blisterSwaps = 0;
    let mainSwaps = 0;
    let skipped = 0;

    for (const r of rows) {
      if (SKIP_COIN_IDS.has(Number(r.id))) {
        skipped++;
        continue;
      }
      const blo = r.image_blister_obverse && String(r.image_blister_obverse).trim();
      const blr = r.image_blister_reverse && String(r.image_blister_reverse).trim();
      const hasBlisterPair = !!(blo && blr);

      if (hasBlisterPair) {
        const bo = foreignBasename(blo);
        const br = foreignBasename(blr);
        if (!bo || !br) {
          skipped++;
          continue;
        }
        if (swapPair(bo, br, `id=${r.id} blister`)) blisterSwaps++;
        else skipped++;
        continue;
      }

      const obv = r.image_obverse && String(r.image_obverse).trim();
      const rev = r.image_reverse && String(r.image_reverse).trim();
      if (!obv || !rev) {
        skipped++;
        continue;
      }
      const oBase = foreignBasename(obv);
      const rBase = foreignBasename(rev);
      if (!oBase || !rBase) {
        skipped++;
        continue;
      }
      if (/blister/i.test(oBase) || /blister/i.test(rBase)) {
        skipped++;
        continue;
      }
      if (!/-obv\.webp$/i.test(oBase) || !/-rev\.webp$/i.test(rBase)) {
        skipped++;
        continue;
      }
      if (swapPair(oBase, rBase, `id=${r.id} main`)) mainSwaps++;
      else skipped++;
    }

    console.log("—");
    console.log("Строк PAMP в выборке:", rows.length);
    console.log("Обменено пар (блистер):", blisterSwaps);
    console.log("Обменено пар (obv/rev):", mainSwaps);
    console.log("Пропусков:", skipped);
  } finally {
    await conn.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
