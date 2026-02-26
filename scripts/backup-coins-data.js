/**
 * Копирует экспорт монет (public/data) в отдельную папку backup-coins-data/.
 * Ничего не удаляет. Запуск: npm run backup:coins
 */
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const SRC = path.join(ROOT, "public", "data");
const DST = path.join(ROOT, "backup-coins-data");

function copyFile(src, dst) {
  const dir = path.dirname(dst);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.copyFileSync(src, dst);
}

function copyDir(srcDir, dstDir) {
  if (!fs.existsSync(srcDir)) return;
  if (!fs.existsSync(dstDir)) fs.mkdirSync(dstDir, { recursive: true });
  const names = fs.readdirSync(srcDir);
  for (const name of names) {
    const srcPath = path.join(srcDir, name);
    const dstPath = path.join(dstDir, name);
    if (fs.statSync(srcPath).isDirectory()) copyDir(srcPath, dstPath);
    else copyFile(srcPath, dstPath);
  }
}

const files = ["coins.json", "coin-ids.json"];
for (const f of files) {
  const src = path.join(SRC, f);
  if (fs.existsSync(src)) copyFile(src, path.join(DST, f));
}
copyDir(path.join(SRC, "coins"), path.join(DST, "coins"));
console.log("Резервная копия экспорта монет записана в backup-coins-data/");
