/**
 * Проверяет, какие товары Kookaburra на Chards не попали
 * в наш JSON chards-kookaburra-raw.json.
 *
 * Логика:
 *  - ещё раз обходит страницы списка Kookaburra на Chards;
 *  - собирает ВСЕ href карточек из грида без доп. фильтров;
 *  - сравнивает набор ссылок с полем productUrl в chards-kookaburra-raw.json;
 *  - печатает список "лишних" ссылок, которых нет в JSON.
 *
 * Запуск:
 *   node scripts/check-chards-kookaburra-missing.js
 */

/* eslint-disable no-console */

const fs = require("fs");
const path = require("path");

const ROOT_URL =
  "https://www.chards.co.uk/category/buy-coins/a/silver/kookaburra/australia";
const PRODUCT_BASE = "https://www.chards.co.uk";

const PROJECT_ROOT = path.join(__dirname, "..");
const DATA_DIR = path.join(PROJECT_ROOT, "data");
const RAW_JSON = path.join(DATA_DIR, "chards-kookaburra-raw.json");

async function getAllProductUrls(page) {
  const urls = new Set();
  let pageIndex = 1;

  /* eslint-disable no-constant-condition */
  while (true) {
    const url =
      pageIndex === 1 ? ROOT_URL : `${ROOT_URL}?page=${pageIndex}`;
    console.log(`Страница списка ${pageIndex}: ${url}`);
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 });
    await page.waitForTimeout(1500);

    const result = await page.evaluate(() => {
      const grid = document.querySelector(
        "div.tw-grid.tw-gap-y-4.tw-gap-x-1.sm\\:tw-gap-x-3.sm\\:tw-gap-y-10.lg\\:tw-gap-x-4.tw-grid-cols-2.md\\:tw-grid-cols-3.lg\\:tw-grid-cols-4"
      );
      const cards = grid
        ? Array.from(grid.querySelectorAll("a[href]"))
        : Array.from(document.querySelectorAll("a[href]"));

      const hrefs = cards
        .map((a) => a.getAttribute("href"))
        .filter(Boolean);

      const pagination = document.querySelector(".pagination");
      let hasNext = false;
      if (pagination) {
        const nextLink = Array.from(
          pagination.querySelectorAll("a, button")
        ).find((el) => {
          const label =
            el.getAttribute("aria-label") || el.textContent || "";
          return /next/i.test(label) && !el.hasAttribute("aria-disabled");
        });
        if (nextLink) hasNext = true;
      }

      return { hrefs, hasNext };
    });

    for (const href of result.hrefs) {
      const full = href.startsWith("http")
        ? href
        : `${PRODUCT_BASE}${href}`;
      urls.add(full);
    }

    console.log(
      `  Найдено href на этой странице: ${result.hrefs.length}, всего уникальных: ${urls.size}`
    );

    if (!result.hasNext) break;
    pageIndex += 1;
  }

  return Array.from(urls);
}

async function main() {
  if (!fs.existsSync(RAW_JSON)) {
    console.error("Не найден JSON:", RAW_JSON);
    process.exit(1);
  }
  const raw = JSON.parse(fs.readFileSync(RAW_JSON, "utf8"));
  const haveSet = new Set(raw.map((r) => r.productUrl));

  let chromium;
  try {
    // eslint-disable-next-line global-require, import/no-extraneous-dependencies
    const playwrightExtra = require("playwright-extra");
    // eslint-disable-next-line global-require, import/no-extraneous-dependencies
    chromium = playwrightExtra.chromium;
    chromium.use(require("puppeteer-extra-plugin-stealth")());
  } catch (e) {
    console.error(
      "Нужны зависимости: playwright-extra, puppeteer-extra-plugin-stealth"
    );
    process.exit(1);
  }

  const browser = await chromium.launch({
    headless: true,
    args: ["--no-sandbox"],
  });
  const page = await browser.newPage();
  page.setDefaultTimeout(45000);

  try {
    const allUrls = await getAllProductUrls(page);
    console.log(`\nВсего ссылок в гриде: ${allUrls.length}`);
    console.log(`Ссылок в JSON: ${haveSet.size}`);

    const missing = allUrls.filter((u) => !haveSet.has(u));

    if (!missing.length) {
      console.log("\nВсе товары из списка присутствуют в JSON.");
    } else {
      console.log(
        `\nТовары, которых нет в JSON (шт: ${missing.length}):`
      );
      missing.forEach((u) => console.log(" -", u));
    }
  } finally {
    await page.close();
    await browser.close();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

