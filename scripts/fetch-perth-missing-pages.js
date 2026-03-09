/**
 * Дозабирает ссылки с каталога Perth Mint.
 * Длительное ожидание + прокрутка для lazy load, расширенные селекторы.
 *
 * Запуск:
 *   node scripts/fetch-perth-missing-pages.js --write-full  — 4 проблемные страницы (переход по URL)
 *   node scripts/fetch-perth-missing-pages.js --all --write-full   — все страницы 1–27
 */
const fs = require("fs");
const path = require("path");

const URL_LIST_FILE = path.join(__dirname, "perth-mint-urls.txt");
const DATA_DIR = path.join(__dirname, "..", "data");
const PAGES_FILE = path.join(DATA_DIR, "perth-mint-listing-pages-to-check.txt");
const BASE_LISTING =
  "https://www.perthmint.com/shop/collector-coins?p_metal=Bi%20Metal&p_metal=Gold&p_metal=Pink%20Gold&p_metal=Platinum&p_metal=Rose%20Gold&p_metal=Silver&page=1&pageSize=36&query&sortValue=4";

function setPage(pageNum) {
  const u = new URL(BASE_LISTING);
  u.searchParams.set("page", String(pageNum));
  return u.toString();
}

/** Номера страниц и URL из отчёта. Возвращает [{ pageNum, url }]. */
function parsePagesFile() {
  if (!fs.existsSync(PAGES_FILE)) return [];
  const items = [];
  const text = fs.readFileSync(PAGES_FILE, "utf8");
  text.split("\n").forEach((line) => {
    const m = line.match(/Страница\s+(\d+)[^U]*URL:\s*(https:\/\/[^\s]+)/);
    if (m) items.push({ pageNum: parseInt(m[1], 10), url: m[2].trim() });
  });
  return items.sort((a, b) => a.pageNum - b.pageNum);
}

/** Для --all: страницы с start до maxPage. Каталог Perth заканчивается на 27. */
function getAllPageUrls(maxPage = 27, startFrom = 1) {
  return Array.from({ length: maxPage - startFrom + 1 }, (_, i) => setPage(startFrom + i));
}

/** Клик по «следующая страница». Perth Mint — SPA, переход по URL может не сработать. */
async function clickNextPage(page) {
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await page.waitForTimeout(500);
  const selectorsNext = [
    "li.VuePagination_pagination-item-next:not(.disabled)",
    "li.VuePagination__pagination-item--next-page:not(.disabled)",
    "li.VuePagination_pagination-item-next-chunk:not(.disabled)",
  ];
  const clicked = await page.evaluate((selectors) => {
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
    for (const li of list.querySelectorAll("li:not(.disabled)")) {
      const a = li.querySelector("a.page-link, a, button");
      if (!a) continue;
      const t = (a.textContent || "").trim();
      if (t === ">" || t === "›" || /^next$/i.test(t)) {
        a.click();
        return true;
      }
    }
    return false;
  }, selectorsNext);
  return !!clicked;
}

/** Расширенное извлечение: карточки, ссылки, data-атрибуты, router-link. */
async function extractAllUrls(page) {
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
    const hrefs = new Set();

    document.querySelectorAll("a[href*='/shop/collector-coins/']").forEach((a) => {
      const h = a.href || norm(a.getAttribute("href"));
      if (isCoinLink(h)) hrefs.add(h);
    });

    document.querySelectorAll("[data-product-url], [data-href], [href]").forEach((el) => {
      const h = el.getAttribute("data-product-url") || el.getAttribute("data-href") || el.getAttribute("href");
      if (h && isCoinLink(h)) hrefs.add(norm(h));
    });

    document.querySelectorAll("[router-link], [data-router-link]").forEach((el) => {
      const to = el.getAttribute("to") || el.getAttribute("data-to") || el.getAttribute("router-link");
      if (to && isCoinLink(to)) hrefs.add(norm(to));
    });

    return Array.from(hrefs);
  });
}

async function main() {
  const useAll = process.argv.includes("--all");
  const startArg = process.argv.find((a) => a.startsWith("--start"));
  let startPage = 1;
  if (startArg) {
    const n = startArg.includes("=") ? startArg.split("=")[1] : process.argv[process.argv.indexOf(startArg) + 1];
    startPage = Math.max(1, parseInt(n, 10) || 1);
  }
  const targets = useAll
    ? getAllPageUrls(27, startPage).map((url, i) => ({ pageNum: startPage + i, url }))
    : parsePagesFile();
  if (targets.length === 0 && !useAll) {
    console.log("Нет файла", PAGES_FILE, "или он пуст. Используйте --all для обхода всех страниц.");
    process.exit(1);
  }

  const initialUrls = fs.existsSync(URL_LIST_FILE)
    ? fs.readFileSync(URL_LIST_FILE, "utf8")
        .split(/\r?\n/)
        .map((s) => s.trim())
        .filter((s) => s.startsWith("http"))
    : [];
  const useUrlDirect = !process.argv.includes("--clicks");
  const canonical = (u) => (u.endsWith("/") ? u : u + "/");
  const normalize = (u) => (u.replace(/\/$/, "") || u);
  const initialNorm = new Set(initialUrls.map(normalize));
  const existing = new Map();
  initialUrls.forEach((u) => existing.set(normalize(u), canonical(u)));

  if (useAll && startPage > 1) console.log("Продолжаем с страницы", startPage);
  console.log(useAll ? "Режим --all: страницы " + startPage + ".." + (startPage + targets.length - 1) : "Страниц из отчёта:", targets.length);
  console.log(useUrlDirect ? "Переход по URL." : "Переход по кликам (--clicks).");
  console.log("В списке до запуска:", existing.size, "(нормализованная проверка на дубли)");

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

  const browser = await chromium.launch({
    headless: process.env.HEADLESS !== "0",
    args: ["--no-sandbox"],
  });
  const context = await browser.newContext({
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36",
    viewport: { width: 1280, height: 900 },
  });

  const page = await context.newPage();
  let currentPageNum = 0;
  const firstUrl = setPage(1);

  const gotoPage = async (targetNum) => {
    if (useUrlDirect) {
      const u = setPage(targetNum);
      await page.goto(u, { waitUntil: "load", timeout: 90000 });
      currentPageNum = targetNum;
      return true;
    }
    const need = targetNum - currentPageNum;
    for (let k = 0; k < need; k++) {
      if (!(await clickNextPage(page))) return false;
      await page.waitForTimeout(1200);
    }
    currentPageNum = targetNum;
    return true;
  };

  const waitScrollExtract = async () => {
    await page.waitForTimeout(3000);
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(500);
    for (let y = 300; y < 3000; y += 400) {
      await page.evaluate((yp) => window.scrollTo(0, yp), y);
      await page.waitForTimeout(800);
    }
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(2000);
    let urls1 = await extractAllUrls(page);
    await page.waitForTimeout(1500);
    let urls2 = await extractAllUrls(page);
    let combined = [...new Set([...urls1, ...urls2])];
    if (combined.length < 12 && combined.length > 0) {
      console.log("  Мало ссылок, повтор через 5 сек...");
      await page.waitForTimeout(5000);
      for (let y = 200; y < 2500; y += 300) {
        await page.evaluate((yp) => window.scrollTo(0, yp), y);
        await page.waitForTimeout(600);
      }
      const urls3 = await extractAllUrls(page);
      combined = [...new Set([...combined, ...urls3])];
    }
    return combined;
  };

  try {
    if (!useUrlDirect) {
      console.log("\nОткрываем страницу 1...");
      await page.goto(firstUrl, { waitUntil: "load", timeout: 90000 });
      await page.waitForSelector(".product-list__cards, .product-list__product, [class*='product']", { timeout: 15000 }).catch(() => {});
      currentPageNum = 1;
    }

    for (let i = 0; i < targets.length; i++) {
      const target = targets[i];
      const pageNum = target.pageNum;
      console.log("\n——— Страница", pageNum, "/", targets.length, "———");

      if (pageNum > currentPageNum) {
        const reached = await gotoPage(pageNum);
        if (!reached) {
          console.log("  Не удалось перейти на страницу", pageNum);
          if (useAll) break;
          continue;
        }
      }
      const combined = await waitScrollExtract();

      if (useAll && combined.length === 0) {
        console.log("  Пусто — конец каталога.");
        break;
      }

      combined.forEach((u) => {
        const n = normalize(u);
        if (!existing.has(n)) existing.set(n, canonical(u));
      });
      const newOnPage = combined.filter((u) => !initialNorm.has(normalize(u))).length;
      console.log("  Ссылок:", combined.length, "| новых:", newOnPage);
      await new Promise((r) => setTimeout(r, 800));
    }
  } finally {
    await page.close();
    await browser.close();
  }

  const fullList = Array.from(existing.values()).sort();
  const list = fullList.filter((u) => !initialNorm.has(normalize(u)));
  console.log("\nВсего уникальных URL:", fullList.length, "| новых (не было в файле):", list.length);

  const writeFull = process.argv.includes("--write-full");

  if (writeFull && fullList.length > 0) {
    fs.writeFileSync(URL_LIST_FILE, fullList.join("\n") + "\n", "utf8");
    console.log("Перезаписан", URL_LIST_FILE, "— всего", fullList.length, "URL");
  } else if (list.length > 0) {
    const block = "\n# Дозабрано fetch-perth-missing-pages.js" + (useAll ? " --all" : "") + "\n" + list.join("\n") + "\n";
    fs.appendFileSync(URL_LIST_FILE, block, "utf8");
    console.log("Дописано в", URL_LIST_FILE, "—", list.length, "URL");
  } else if (!useAll) {
    console.log("Новых ссылок не найдено.");
  }
  if (fullList.length > 0) {
    console.log("Дальше: node scripts/prune-perth-canonicals.js (если --write-full) → fetch-perth-mint-coin.js");
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
