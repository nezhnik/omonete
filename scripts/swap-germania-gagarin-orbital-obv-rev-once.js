/**
 * Однократный обмен obv/rev для Interkosmos Gagarin Orbital (6489).
 * Не трогает другие пары (в отличие от swap-germania-wmf-screenshot-obv-rev-files.js).
 * Запуск: node scripts/swap-germania-gagarin-orbital-obv-rev-once.js
 */
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const FOREIGN_DIR = path.join(__dirname, "..", "public", "image", "coins", "foreign");
const O = "2021-interkosmos-gagarin-orbital-1oz-obv.webp";
const R = "2021-interkosmos-gagarin-orbital-1oz-rev.webp";

const obv = path.join(FOREIGN_DIR, O);
const rev = path.join(FOREIGN_DIR, R);
if (!fs.existsSync(obv) || !fs.existsSync(rev)) {
  console.error("Нет файлов:", O, R);
  process.exit(1);
}
const tmp = path.join(FOREIGN_DIR, `.swap-${crypto.randomBytes(8).toString("hex")}-${O}`);
fs.renameSync(obv, tmp);
fs.renameSync(rev, obv);
fs.renameSync(tmp, rev);
console.log("OK:", O, "↔", R);
