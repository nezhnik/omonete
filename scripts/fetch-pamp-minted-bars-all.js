/**
 * Массовый парсинг minted bars из scripts/pamp-minted-bars-urls.txt
 * (только URL вида /product/minted-ingots/...).
 *
 * Один запуск Chromium: по очереди открываем страницы, парсим и качаем картинки в той же сессии.
 * Пишет data/pamp-minted-bar-*.json — импорт: npm run pamp:import:minted-bars
 */
const fs = require("fs");
const path = require("path");
const {
  launchPampBrowser,
  fetchPampProductOnce,
  writePampProductJson,
  DATA_DIR,
} = require("./fetch-pamp-product.js");

const URL_LIST_FILE = path.join(__dirname, "pamp-minted-bars-urls.txt");

function readUrls() {
  if (!fs.existsSync(URL_LIST_FILE)) {
    console.error("Файл со ссылками не найден. Сначала: npm run pamp:listing:minted-bars");
    console.error("Ожидается:", URL_LIST_FILE);
    process.exit(1);
  }
  return fs
    .readFileSync(URL_LIST_FILE, "utf8")
    .split(/\r?\n/)
    .map((x) => x.trim())
    .filter((x) => /^https?:\/\//i.test(x) && /\/product\/minted-ingots\//i.test(x));
}

async function main() {
  const urls = Array.from(new Set(readUrls()));
  if (!urls.length) {
    console.error("Нет URL /product/minted-ingots/ в списке");
    process.exit(1);
  }
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

  let browser;
  let ok = 0;
  let fail = 0;
  try {
    const launched = await launchPampBrowser();
    browser = launched.browser;
    const { context, page, gqlCapture } = launched;
    for (let i = 0; i < urls.length; i++) {
      const url = urls[i];
      console.log(`[${i + 1}/${urls.length}] ${url}`);
      try {
        const result = await fetchPampProductOnce(context, page, gqlCapture, url, "minted");
        if (result.strictImageFail && process.env.PAMP_STRICT_IMAGES === "1") {
          fail++;
          continue;
        }
        const outFile = writePampProductJson(result);
        console.log("  →", outFile, result.parsed?.title || "—");
        ok++;
      } catch (e) {
        console.error(e);
        fail++;
      }
    }
  } finally {
    if (browser) await browser.close();
  }
  console.log("Готово.");
  console.log("Успешно:", ok);
  console.log("Ошибок:", fail);
  console.log("Далее: npm run pamp:import:minted-bars && npm run data:export");
  if (fail > 0) process.exitCode = 1;
}

if (require.main === module) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
