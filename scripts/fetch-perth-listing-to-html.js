/**
 * Забирает HTML страниц каталога Perth Mint через клик «Next» (SPA).
 * Сохраняет в data/perth-listing-page-N.html. Потом ссылки извлекают локально.
 *
 *   node scripts/fetch-perth-listing-to-html.js
 */
const fs = require("fs");
const path = require("path");

const DATA_DIR = path.join(__dirname, "..", "data");
const BASE_LISTING =
  "https://www.perthmint.com/shop/collector-coins?p_metal=Bi%20Metal&p_metal=Gold&p_metal=Pink%20Gold&p_metal=Platinum&p_metal=Rose%20Gold&p_metal=Silver&page=1&pageSize=36&query&sortValue=4";

/** Клик по «следующая страница». Perth Mint — SPA, переход по URL не работает. */
async function clickNextPage(page) {
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await page.waitForTimeout(500);
  const clicked = await page.evaluate(() => {
    const list = document.querySelector("ul.pagination, .VuePagination_pagination, .VuePagination__pagination");
    if (!list) return false;
    const selectors = [
      "li.VuePagination_pagination-item-next:not(.disabled)",
      "li.VuePagination__pagination-item--next-page:not(.disabled)",
    ];
    for (const sel of selectors) {
      const li = list.querySelector(sel);
      if (li) {
        const a = li.querySelector("a.page-link, a, button");
        if (a) { a.click(); return true; }
      }
    }
    for (const li of list.querySelectorAll("li:not(.disabled)")) {
      const a = li.querySelector("a.page-link, a, button");
      if (!a) continue;
      const t = (a.textContent || "").trim();
      if (t === ">" || t === "›" || /^next$/i.test(t)) { a.click(); return true; }
    }
    return false;
  });
  return !!clicked;
}

async function main() {
  let chromium, stealth;
  try {
    const playwrightExtra = require("playwright-extra");
    chromium = playwrightExtra.chromium;
    stealth = require("puppeteer-extra-plugin-stealth")();
    chromium.use(stealth);
  } catch (e) {
    console.error("Нужны: playwright, playwright-extra, puppeteer-extra-plugin-stealth");
    process.exit(1);
  }

  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

  const browser = await chromium.launch({
    headless: process.env.HEADLESS !== "0",
    args: ["--no-sandbox"],
  });
  const context = await browser.newContext({
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36",
    viewport: { width: 1280, height: 900 },
  });
  const page = await context.newPage();
  page.setDefaultTimeout(25000);

  console.log("Открываем страницу 1...");
  await page.goto(BASE_LISTING, { waitUntil: "load", timeout: 90000 });
  await page.waitForSelector(".product-list__product, .product-list__cards", { timeout: 15000 }).catch(() => {});

  for (let n = 1; n <= 27; n++) {
    const outFile = path.join(DATA_DIR, `perth-listing-page-${n}.html`);
    console.log(`Страница ${n}/27 → ${path.basename(outFile)}`);

    await page.waitForTimeout(2000);
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(400);
    for (let y = 300; y < 3000; y += 400) {
      await page.evaluate((yp) => window.scrollTo(0, yp), y);
      await page.waitForTimeout(600);
    }
    await page.waitForTimeout(1500);

    const html = await page.content();
    fs.writeFileSync(outFile, html, "utf8");

    if (n < 27) {
      const hasNext = await clickNextPage(page);
      if (!hasNext) {
        console.log("  Кнопка Next недоступна — конец каталога.");
        break;
      }
      await page.waitForTimeout(1800);
    }
  }

  await page.close();
  await browser.close();
  console.log("\nГотово. Дальше: node scripts/extract-perth-links-from-html.js --stats --merge");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
