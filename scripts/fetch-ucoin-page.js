/**
 * Загружает одну страницу с ucoin.net через браузер (обходит Cloudflare).
 * Один запрос — минимальный риск. Результат сохраняется в HTML-файл, парсер читает его.
 *
 * Запуск: node scripts/fetch-ucoin-page.js
 *   Или: node scripts/fetch-ucoin-page.js "https://ru.ucoin.net/coin/usa-1-dollar-1986-2021/?tid=16895"
 */
const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");

const URL =
  process.argv[2] ||
  "https://ru.ucoin.net/coin/usa-1-dollar-1986-2021/?tid=16895";
const OUT_HTML = path.join(
  __dirname,
  "..",
  "data",
  "ucoin-usa-1-dollar-1986-2021.html"
);
const DATA_DIR = path.dirname(OUT_HTML);

async function main() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }

  console.log("Открываю страницу в браузере...");
  const browser = await chromium.launch({
    headless: true,
    args: ["--disable-blink-features=AutomationControlled"],
  });

  const context = await browser.newContext({
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    viewport: { width: 1920, height: 1080 },
    locale: "ru-RU",
  });

  const page = await context.newPage();

  try {
    await page.goto(URL, {
      waitUntil: "networkidle",
      timeout: 60000,
    });

    // Ждём исчезновения Cloudflare "Just a moment..."
    await page.waitForSelector("text=Just a moment", { state: "detached", timeout: 15000 }).catch(() => {});

    // Доп. ожидание загрузки контента
    await page.waitForTimeout(3000);

    const html = await page.content();
    fs.writeFileSync(OUT_HTML, html, "utf8");

    console.log("✓ Страница сохранена:", OUT_HTML);
    console.log("Размер:", (html.length / 1024).toFixed(1), "KB");
  } catch (err) {
    console.error("Ошибка:", err.message);
    process.exit(1);
  } finally {
    await browser.close();
  }
}

main();
