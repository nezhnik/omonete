/**
 * Собирает ссылки на товары со страницы каталога Perth Mint (листинг).
 * Прогресс сохраняется в data/perth-mint-listing-progress.json: при следующем запуске
 * продолжает с последней страницы и не дублирует уже собранные ссылки.
 * Запуск: node scripts/fetch-perth-mint-listing.js [url_каталога]
 * По умолчанию: pageSize=36.
 */
const fs = require("fs");
const path = require("path");

const URL_LIST_FILE = path.join(__dirname, "perth-mint-urls.txt");
const DATA_DIR = path.join(__dirname, "..", "data");
const PROGRESS_FILE = path.join(DATA_DIR, "perth-mint-listing-progress.json");
const DEFAULT_LISTING =
  "https://www.perthmint.com/shop/collector-coins?p_metal=Gold&p_metal=Pink%20Gold&p_metal=Platinum&p_metal=Rose%20Gold&p_metal=Silver&page=1&pageSize=36&query&sortValue=4";

function setPage(url, page) {
  const u = new URL(url);
  u.searchParams.set("page", String(page));
  return u.toString();
}

/** Базовый URL каталога без номера страницы (для ключа прогресса). */
function baseListingUrl(url) {
  const u = new URL(url);
  u.searchParams.set("page", "1");
  return u.toString();
}

function loadProgress(baseUrl) {
  if (!fs.existsSync(PROGRESS_FILE)) return { collectedUrls: [], lastPageNum: 0 };
  try {
    const data = JSON.parse(fs.readFileSync(PROGRESS_FILE, "utf8"));
    if (data.listingUrl === baseUrl && Array.isArray(data.collectedUrls))
      return { collectedUrls: data.collectedUrls, lastPageNum: data.lastPageNum || 0 };
  } catch (e) {}
  return { collectedUrls: [], lastPageNum: 0 };
}

function saveProgress(baseUrl, collectedUrls, lastPageNum) {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(
    PROGRESS_FILE,
    JSON.stringify({
      listingUrl: baseUrl,
      collectedUrls: Array.from(collectedUrls),
      lastPageNum,
      updatedAt: new Date().toISOString(),
    }),
    "utf8"
  );
}

/**
 * Ссылки из блока product-list__cards (grid с карточками .product-list__product).
 * В каждой карточке ищем любую ссылку на товар: /shop/collector-coins/coins/ или /shop/collector-coins/ (страница монеты).
 */
async function extractProductUrls(page) {
  return page.evaluate(() => {
    const norm = (h) => {
      if (!h) return null;
      if (h.startsWith("http")) return h;
      const origin = window.location.origin;
      return h.startsWith("/") ? origin + h : origin + "/" + h;
    };
    const isCoinLink = (href) => {
      if (!href || href.includes("?")) return false;
      if (href.includes("/shop/collector-coins/coins/")) return true;
      const match = href.match(/\/shop\/collector-coins\/([^/?#]+)/);
      return !!(match && match[1]);
    };
    const container = document.querySelector(".product-list__cards");
    const hrefs = new Set();
    let cardCount = 0;
    if (container) {
      const cards = container.querySelectorAll(".product-list__product");
      cardCount = cards.length;
      cards.forEach((card) => {
        card.querySelectorAll("a[href]").forEach((a) => {
          const h = a.href || norm(a.getAttribute("href"));
          if (isCoinLink(h)) hrefs.add(h);
        });
        const parentA = card.closest("a[href]");
        if (parentA) {
          const h = parentA.href || norm(parentA.getAttribute("href"));
          if (isCoinLink(h)) hrefs.add(h);
        }
      });
      container.querySelectorAll("a[href*='/shop/collector-coins/']").forEach((a) => {
        const h = a.href || norm(a.getAttribute("href"));
        if (isCoinLink(h)) hrefs.add(h);
      });
    }
    if (hrefs.size === 0) {
      document.querySelectorAll("a[href*='/shop/collector-coins/']").forEach((a) => {
        const h = a.href || norm(a.getAttribute("href"));
        if (isCoinLink(h)) hrefs.add(h);
      });
    }
    return { urls: Array.from(hrefs), cardCount };
  });
}

/** Есть ли на странице сообщение "No matches found" */
async function hasNoMatches(page) {
  return page.evaluate(() => {
    const text = document.body ? document.body.innerText : "";
    return /no matches found/i.test(text);
  });
}

/** Клик по «следующая страница» (>) или «следующий блок страниц» (>>). На сайте классы могут быть VuePagination_pagination или VuePagination__pagination-item--next-page. */
async function clickNextPage(page) {
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await page.waitForTimeout(500);

  const selectorsNext = [
    "li.VuePagination_pagination-item-next:not(.disabled)",
    "li.VuePagination__pagination-item--next-page:not(.disabled)",
    "li.VuePagination_pagination-item-next-chunk:not(.disabled)",
    "li.VuePagination__pagination-item--next-chunk:not(.disabled)",
  ];

  let clicked = await page.evaluate((selectors) => {
    const list = document.querySelector("ul.pagination, .VuePagination_pagination, .VuePagination__pagination");
    if (!list) return false;
    for (const sel of selectors) {
      const li = list.querySelector(sel);
      if (li) {
        const a = li.querySelector("a.page-link, a, button");
        if (a) {
          a.click();
          return true;
        }
      }
    }
    const items = list.querySelectorAll("li:not(.disabled)");
    for (const li of items) {
      const a = li.querySelector("a.page-link, a, button");
      if (!a) continue;
      const t = (a.textContent || "").trim();
      if (t === ">" || t === "›" || /^next$/i.test(t)) {
        a.click();
        return true;
      }
      if (t === "»" || t === ">>") {
        a.click();
        return true;
      }
    }
    return false;
  }, selectorsNext);

  if (!clicked) {
    await page.waitForTimeout(1500);
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(500);
    clicked = await page.evaluate((selectors) => {
      const list = document.querySelector("ul.pagination, .VuePagination_pagination, .VuePagination__pagination");
      if (!list) return false;
      for (const sel of selectors) {
        const li = list.querySelector(sel);
        if (li) {
          const a = li.querySelector("a, button");
          if (a) {
            a.click();
            return true;
          }
        }
      }
      return false;
    }, selectorsNext);
  }
  return !!clicked;
}

async function main() {
  const listingUrl = process.argv[2] && process.argv[2].startsWith("http") ? process.argv[2] : DEFAULT_LISTING;
  const fullScan = process.argv.includes("--full");
  const baseUrl = baseListingUrl(listingUrl);
  let progress = fullScan ? { collectedUrls: [], lastPageNum: 0 } : loadProgress(baseUrl);
  if (!fullScan && progress.collectedUrls.length === 0 && fs.existsSync(URL_LIST_FILE)) {
    const existing = fs.readFileSync(URL_LIST_FILE, "utf8");
    const fromFile = existing.split(/\r?\n/).map((s) => s.trim()).filter((s) => s.startsWith("http"));
    if (fromFile.length > 0) {
      progress = { collectedUrls: fromFile, lastPageNum: 28 };
      saveProgress(baseUrl, new Set(progress.collectedUrls), progress.lastPageNum);
      console.log("Прогресс восстановлен из файла:", fromFile.length, "ссылок, следующая страница 29");
    }
  }
  const allUrls = new Set(progress.collectedUrls);
  let startPage = progress.lastPageNum + 1;

  console.log("Каталог:", listingUrl);
  if (fullScan) console.log("Режим: полный проход с страницы 1 (--full)");
  else if (progress.collectedUrls.length > 0) {
    console.log("Прогресс: уже собрано", progress.collectedUrls.length, "ссылок, продолжаем с страницы", startPage);
  }

  let chromium;
  let stealth;
  try {
    const playwrightExtra = require("playwright-extra");
    chromium = playwrightExtra.chromium;
    stealth = require("puppeteer-extra-plugin-stealth")();
    chromium.use(stealth);
  } catch (e) {
    console.error("Нужны: playwright, playwright-extra, puppeteer-extra-plugin-stealth");
    process.exit(1);
  }

  const browser = await chromium.launch({
    headless: process.env.HEADLESS !== "0",
    args: ["--no-sandbox"],
  });
  const context = await browser.newContext({
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    viewport: { width: 1280, height: 800 },
  });

  let pageNum = startPage;
  const page = await context.newPage();
  const pagesWithFewerLinks = [];

  try {
    const firstPageUrl = setPage(listingUrl, pageNum);
    console.log("Страница", pageNum, "...");
    await page.goto(firstPageUrl, { waitUntil: "networkidle", timeout: 45000 });
    await page.waitForSelector(".product-list__cards .product-list__product", { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(2000);

    while (true) {
      if (await hasNoMatches(page)) {
        console.log("  Нет результатов на странице", pageNum);
        break;
      }

      const { urls, cardCount } = await extractProductUrls(page);
      if (urls.length === 0) break;
      if (cardCount > 0 && urls.length < cardCount) {
        console.log("  ⚠ Карточек в блоке product-list__cards:", cardCount, ", ссылок собрано:", urls.length);
        pagesWithFewerLinks.push({ page: pageNum, cards: cardCount, links: urls.length });
      }
      const beforeSize = allUrls.size;
      urls.forEach((u) => allUrls.add(u));
      const newOnPage = allUrls.size - beforeSize;
      console.log("  Карточек:", cardCount, "| ссылок:", urls.length, "| всего уникальных:", allUrls.size, newOnPage > 0 ? "(+".concat(String(newOnPage), ")") : "");

      saveProgress(baseUrl, allUrls, pageNum);

      const nextClicked = await clickNextPage(page);
      if (!nextClicked) {
        console.log("  Кнопки «следующая страница» нет, конец.");
        break;
      }
      const firstUrlPrev = urls[0];
      for (let w = 0; w < 24; w++) {
        await page.waitForTimeout(500);
        const { urls: urlsAfter } = await extractProductUrls(page);
        if (urlsAfter.length > 0 && urlsAfter[0] !== firstUrlPrev) break;
      }
      pageNum++;
      if (pageNum % 20 === 0 || pageNum === startPage + 1) console.log("  — страница", pageNum);
      await new Promise((r) => setTimeout(r, 400));
    }
  } finally {
    await page.close();
    await browser.close();
  }

  const list = Array.from(allUrls).sort();
  console.log("\nВсего ссылок на товары:", list.length);

  if (pagesWithFewerLinks.length > 0) {
    console.log("\nМеньше 36 ссылок на страницах (проверьте вручную):");
    const reportLines = [
      "Страницы каталога Perth Mint, где собрано ссылок меньше, чем карточек (36). Проверьте вручную.",
      "Формат: страница N — откройте каталог с page=N в URL.",
      "",
      ...pagesWithFewerLinks.map(({ page: p, cards, links }) => `Страница ${p} — карточек: ${cards}, ссылок: ${links} — URL: ${setPage(listingUrl, p)}`),
    ];
    pagesWithFewerLinks.forEach(({ page: p, cards, links }) => {
      console.log("  Страница", p, "— карточек:", cards, ", ссылок:", links);
    });
    const reportPath = path.join(DATA_DIR, "perth-mint-listing-pages-to-check.txt");
    fs.writeFileSync(reportPath, reportLines.join("\n"), "utf8");
    console.log("\nОтчёт записан в", reportPath);
  }

  if (list.length === 0) {
    console.log("Нечего дописывать в файл.");
    return;
  }

  let existing = "";
  if (fs.existsSync(URL_LIST_FILE)) {
    existing = fs.readFileSync(URL_LIST_FILE, "utf8");
  }
  const existingUrls = new Set(
    existing
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter((s) => s.startsWith("http"))
  );
  const toAppend = list.filter((u) => !existingUrls.has(u));
  if (toAppend.length === 0) {
    console.log("Все ссылки уже есть в", URL_LIST_FILE);
    return;
  }

  const block = "\n# Собрано скриптом fetch-perth-mint-listing.js\n" + toAppend.join("\n") + "\n";
  fs.appendFileSync(URL_LIST_FILE, block, "utf8");
  console.log("Дописано в", URL_LIST_FILE, "новых ссылок:", toAppend.length);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
