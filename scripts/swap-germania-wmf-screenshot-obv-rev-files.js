/**
 * Меняет местами содержимое пар *-obv.webp и *-rev.webp (и blister-*) для монет со скриншотов.
 * Пути в БД/JSON не трогаем — только переименование на диске (три шага через temp).
 *
 * Запуск: node scripts/swap-germania-wmf-screenshot-obv-rev-files.js
 */
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const FOREIGN_DIR = path.join(__dirname, "..", "public", "image", "coins", "foreign");

/** Базовые имена файлов (без пути): [obv, rev] */
const PAIRS = [
  ["2025-germania-1oz-black-silver-bu-wmf-obv.webp", "2025-germania-1oz-black-silver-bu-wmf-rev.webp"],
  ["2023-allegories-polonia-germania-2oz-wmf-obv.webp", "2023-allegories-polonia-germania-2oz-wmf-rev.webp"],
  ["2019-germania-1oz-wmf-2020-blister-obv.webp", "2019-germania-1oz-wmf-2020-blister-rev.webp"],
  ["2019-oak-leaf-1oz-wmf-2020-blister-obv.webp", "2019-oak-leaf-1oz-wmf-2020-blister-rev.webp"],
  ["2019-allegories-britannia-1oz-wmf-blister-obv.webp", "2019-allegories-britannia-1oz-wmf-blister-rev.webp"],
  ["2019-allegories-columbia-1oz-wmf-blister-obv.webp", "2019-allegories-columbia-1oz-wmf-blister-rev.webp"],
];

function swapPair(obvBase, revBase) {
  const obv = path.join(FOREIGN_DIR, obvBase);
  const rev = path.join(FOREIGN_DIR, revBase);
  if (!fs.existsSync(obv) || !fs.existsSync(rev)) {
    console.warn("Пропуск (нет обоих файлов):", obvBase, "+", revBase);
    return false;
  }
  const tmp = path.join(FOREIGN_DIR, `.swap-${crypto.randomBytes(8).toString("hex")}-${obvBase}`);
  fs.renameSync(obv, tmp);
  fs.renameSync(rev, obv);
  fs.renameSync(tmp, rev);
  console.log("OK:", obvBase, "↔", revBase);
  return true;
}

function main() {
  if (!fs.existsSync(FOREIGN_DIR)) {
    console.error("Нет каталога:", FOREIGN_DIR);
    process.exit(1);
  }
  let ok = 0;
  for (const [o, r] of PAIRS) {
    if (swapPair(o, r)) ok++;
  }
  console.log("Готово. Пар обменено:", ok, "/", PAIRS.length);
  if (ok === 0) {
    console.log("Файлы не найдены локально — запустите скрипт на машине, где лежат webp в public/image/coins/foreign/");
  }
}

main();
