/**
 * Загружает одну страницу ucoin через браузер (обход Cloudflare).
 * Использует playwright-extra + stealth: скрывает автоматизацию, имитирует поведение человека.
 * Один запрос — минимальный риск.
 *
 * Запуск: node scripts/ucoin-fetch-page.js [url]
 * По умолчанию: American Silver Eagle (Шагающая свобода) 1986-2021
 *
 * HEADLESS=0 — видимый браузер (часто лучше проходит Cloudflare):
 *   HEADLESS=0 node scripts/ucoin-fetch-page.js
 */
const fs = require("fs");
const path = require("path");

const DEFAULT_URL =
  "https://ru.ucoin.net/coin/usa-1-dollar-1986-2021/?tid=16895";
const OUT_FILE = path.join(
  __dirname,
  "..",
  "data",
  "ucoin-usa-1-dollar-1986-2021.html"
);

function randomDelay(min = 1500, max = 4000) {
  return new Promise((r) => setTimeout(r, Math.floor(Math.random() * (max - min + 1)) + min));
}

async function main() {
  const url = process.argv[2] || DEFAULT_URL;
  console.log("Загрузка через браузер (stealth):", url);

  let chromium;
  let stealth;
  try {
    const playwrightExtra = require("playwright-extra");
    chromium = playwrightExtra.chromium;
    stealth = require("puppeteer-extra-plugin-stealth")();
    chromium.use(stealth);
  } catch (e) {
    console.error("Нужны: npm install playwright playwright-extra puppeteer-extra-plugin-stealth");
    console.error(e.message);
    process.exit(1);
  }

  // headless: false — Cloudflare реже блокирует видимый браузер
  const headless = process.env.HEADLESS !== "0";
  const browser = await chromium.launch({
    headless,
    args: [
      "--disable-blink-features=AutomationControlled",
      "--disable-features=IsolateOrigins,site-per-process",
      "--no-sandbox",
    ],
  });

  const context = await browser.newContext({
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    viewport: { width: 1920, height: 1080 },
    locale: "ru-RU",
    timezoneId: "Europe/Moscow",
    extraHTTPHeaders: {
      "Accept-Language": "ru-RU,ru;q=0.9,en-US;q=0.8,en;q=0.7",
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    },
  });

  const page = await context.newPage();

  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
    await randomDelay(3000, 6000);

    // Имитация человека: движение мыши, скролл
    await page.mouse.move(300, 200);
    await randomDelay(500, 1200);
    await page.evaluate(() => window.scrollBy(0, 300));
    await randomDelay(1000, 2500);
    await page.mouse.move(500, 500);
    await randomDelay(800, 1500);
    await page.evaluate(() => window.scrollBy(0, 200));

    // Дополнительное ожидание для Cloudflare challenge (если есть)
    await randomDelay(4000, 8000);

    const html = await page.content();

    if (
      html.includes("Just a moment") ||
      html.includes("Выполнение проверки безопасности") ||
      html.includes("Один момент")
    ) {
      console.error("Cloudflare не пропустил (даже со stealth).");
      console.error("\nСохраните страницу вручную:");
      console.error("  1. Откройте в обычном браузере:", url);
      console.error("  2. Дождитесь загрузки (все варианты по годам)");
      console.error(
        "  3. Ctrl+S → «Веб-страница, полностью» → сохраните в data/ucoin-usa-1-dollar-1986-2021.html"
      );
      console.error("  4. Запустите: node scripts/parse-ucoin-walking-liberty.js");
      process.exit(1);
    }

    const dir = path.dirname(OUT_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(OUT_FILE, html, "utf8");
    console.log(
      "✓ Сохранено:",
      OUT_FILE,
      "(" + (html.length / 1024).toFixed(1) + " KB)"
    );
  } finally {
    await browser.close();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
