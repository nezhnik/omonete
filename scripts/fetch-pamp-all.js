/**
 * Массовый парсинг всех продуктов PAMP из scripts/pamp-collectibles-urls.txt
 */
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const URL_LIST_FILE = path.join(__dirname, "pamp-collectibles-urls.txt");
const FETCH_ONE_SCRIPT = path.join(__dirname, "fetch-pamp-product.js");

function readUrls() {
  if (!fs.existsSync(URL_LIST_FILE)) {
    console.error("Файл со ссылками не найден:", URL_LIST_FILE);
    process.exit(1);
  }
  return fs
    .readFileSync(URL_LIST_FILE, "utf8")
    .split(/\r?\n/)
    .map((x) => x.trim())
    .filter((x) => /^https?:\/\//i.test(x));
}

function main() {
  const urls = Array.from(new Set(readUrls()));
  if (!urls.length) {
    console.error("Список URL пуст");
    process.exit(1);
  }
  let ok = 0;
  let fail = 0;
  for (let i = 0; i < urls.length; i++) {
    const url = urls[i];
    console.log(`[${i + 1}/${urls.length}] ${url}`);
    const res = spawnSync(process.execPath, [FETCH_ONE_SCRIPT, url], {
      stdio: "inherit",
      env: process.env,
    });
    if (res.status === 0) ok++;
    else fail++;
  }
  console.log("Готово.");
  console.log("Успешно:", ok);
  console.log("Ошибок:", fail);
  if (fail > 0) process.exitCode = 1;
}

main();

