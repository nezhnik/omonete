/**
 * Общая логика сбора карточек с листинга The Royal Mint (как Perth listing, но infinite scroll).
 *
 * Режимы:
 * 1) PLP bullion: #productsView — .item-card / .product-card, a.asset[href], infinite scroll + PLPloadMorePlaceholder
 * 2) Поиск Site Search 360: #ss360-filtered-results ul.ss360-list.ss360-grid.ss360-grid--lg > li — тот же фильтр товаров
 *
 * По умолчанию из списка убираем «Tube», «The Best Value», «Coin Box», грейдинг NGC/PCGS (см. normalizeProducts).
 */
const ORIGIN = "https://www.royalmint.com";

const DEFAULT_GOLD_BULLION_LIST_URL =
  "https://www.royalmint.com/invest/bullion/bullion-coins/gold-coins";

/**
 * Базовая страница поиска silver (как в браузере).
 * Если в URL нет параметра year — перед загрузкой подставляются годы из SILVER_SEARCH_YEAR_TAGS.
 */
const SILVER_SEARCH_PAGE = "https://www.royalmint.com/search-results-page";
const DEFAULT_SILVER_SEARCH_URL = `${SILVER_SEARCH_PAGE}?ss360Query=silver`;

/**
 * Годы как в фильтре SS360: year__#__YYYY (в URL # кодируется как %23).
 * Меняй этот список — меняется «выбор годов» без длинной строки в одном месте.
 */
const SILVER_SEARCH_YEAR_TAGS = [
  2025, 2024, 2026, 2023, 2021, 2022, 2000, 2018, 2019, 1995, 1997, 2001, 2002, 2006, 2009, 2013, 2017, 2020, 1990,
  "mixed_dates",
];

/** Полный URL: silver + сортировка High–Low + твои годы (для сравнения / отладки). */
function buildSilverSearchUrlWithYears() {
  const yearParam = SILVER_SEARCH_YEAR_TAGS.map((y) => `year__%23__${y}`).join(",");
  return `${SILVER_SEARCH_PAGE}?ss360Query=silver&ss360sorting=high_-_low&year=${yearParam}`;
}

/**
 * Для https://www.royalmint.com/search-results-page?ss360Query=silver без year — добавляем годы и сортировку.
 * Своий year= в URL не трогаем.
 */
function enrichSilverSearchUrlIfNeeded(listUrl) {
  try {
    const u = new URL(listUrl);
    if (!/\/search-results-page/i.test(u.pathname)) return listUrl;
    if ((u.searchParams.get("ss360Query") || "").toLowerCase() !== "silver") return listUrl;
    const year = u.searchParams.get("year");
    if (year != null && String(year).trim() !== "") return listUrl;
    return buildSilverSearchUrlWithYears();
  } catch {
    return listUrl;
  }
}

function isSs360SearchUrl(listUrl) {
  const s = String(listUrl);
  return /search-results-page/i.test(s) || /[?&]ss360Query=/i.test(s);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Запросы к инфраструктуре Site Search 360 (подсказка, что виджет отвечает). */
function isLikelySs360Request(url) {
  const u = String(url).toLowerCase();
  return (
    u.includes("sitesearch360.com") ||
    u.includes("ss360.") ||
    u.includes("searchhub.io") ||
    u.includes("group-results") ||
    (u.includes("elastic") && u.includes("ss360"))
  );
}

/**
 * Меньше явных признаков automation в странице (SS360 / Cookiebot в headless).
 * Вызывать до первого goto на домен Royal Mint.
 */
async function applyRoyalMintPageHardening(page) {
  try {
    await page.addInitScript(() => {
      try {
        Object.defineProperty(navigator, "webdriver", { get: () => undefined });
      } catch (_) {}
    });
  } catch {
    /* ignore */
  }
}

/** Chromium: общие флаги. HEADLESS=0 — видимый браузер. ROYAL_MINT_CHROME_CHANNEL=1 — системный Chrome. */
function getRoyalMintChromiumLaunchOptions() {
  const headless = process.env.HEADLESS !== "0";
  const o = { headless, args: ["--disable-blink-features=AutomationControlled"] };
  if (process.env.ROYAL_MINT_CHROME_CHANNEL === "1") o.channel = "chrome";
  return o;
}

function getRoyalMintBrowserContextOptions() {
  return {
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    locale: "en-GB",
    viewport: { width: 1366, height: 900 },
    extraHTTPHeaders: { "Accept-Language": "en-GB,en;q=0.9" },
  };
}

/** Cookiebot мешает подгрузке SS360/скриптов в headless — пробуем несколько селекторов. */
async function acceptRoyalMintCookiebot(page) {
  const idSelectors = [
    "#CybotCookiebotDialogBodyLevelButtonLevelOptinAllowAll",
    "#CybotCookiebotDialogBodyButtonAccept",
    "button#CybotCookiebotDialogBodyLevelButtonLevelOptinAllowall",
  ];
  for (const sel of idSelectors) {
    try {
      const loc = page.locator(sel).first();
      if (await loc.isVisible({ timeout: 2500 }).catch(() => false)) {
        await loc.click({ timeout: 8000 });
        await sleep(2200);
        return;
      }
    } catch {
      /* next */
    }
  }
  try {
    const byRole = page.getByRole("button", { name: /allow all|accept all|i agree|accept/i });
    if (await byRole.first().isVisible({ timeout: 2000 }).catch(() => false)) {
      await byRole.first().click({ timeout: 6000 });
      await sleep(2200);
    }
  } catch {
    /* ignore */
  }
}

/**
 * Ждём появления карточек SS360 в DOM или явного «нет результатов».
 */
async function waitForSs360ListingHydrated(page, timeoutMs = 120000) {
  const liSel =
    "#ss360-filtered-results ul.ss360-list.ss360-grid.ss360-grid--lg > li, #ss360-filtered-results ul.ss360-list.ss360-grid > li";
  const deadline = Date.now() + timeoutMs;

  await page
    .locator("#ss360-filtered-results, ul.ss360-list.ss360-grid")
    .first()
    .waitFor({ state: "visible", timeout: Math.min(90000, timeoutMs) })
    .catch(() => {});

  while (Date.now() < deadline) {
    const n = await page.locator(liSel).count();
    if (n > 0) return true;
    await sleep(650);
  }
  return false;
}

/** Скролл + опционально «Load more», пока число карточек растёт или стабилизируется. */
async function scrollUntilListingStable(page, options = {}) {
  const maxRounds = options.maxRounds ?? 80;
  const stableNeeded = options.stableNeeded ?? 6;
  const pauseMs = options.pauseMs ?? 650;

  let lastCount = 0;
  let stable = 0;

  for (let i = 0; i < maxRounds; i++) {
    await tryClickLoadMore(page);

    await page.evaluate(() => {
      window.scrollBy(0, Math.min(4000, Math.max(800, document.body.scrollHeight - window.innerHeight)));
      // PLPloadMorePlaceholder: пустой якорь infinite scroll — в зоне видимости подгружаются следующие .item-card
      const placeholder = document.querySelector("#loadMorePlaceholder, .PLPloadMorePlaceholder");
      if (placeholder) placeholder.scrollIntoView({ block: "end", inline: "nearest" });
    });
    await sleep(pauseMs);

    const count = await page.locator("#productsView .item-card, #productsView .product-card").count();

    if (count === lastCount) {
      stable += 1;
      if (stable >= stableNeeded && lastCount > 0) break;
    } else {
      stable = 0;
      lastCount = count;
    }
  }
}

async function tryClickLoadMore(page) {
  try {
    const clicked = await page.evaluate(() => {
      const candidates = [
        ...document.querySelectorAll(
          'button[data-load-more], a[data-load-more], .js-load-more, .load-more:not([style*="display: none"]), #loadMorePlaceholder button, #loadMorePlaceholder a'
        ),
      ];
      for (const el of candidates) {
        if (!el || el.offsetParent === null) continue;
        const t = (el.textContent || "").toLowerCase();
        if (/load\s*more|show\s*more/i.test(t) || el.getAttribute("data-load-more")) {
          el.click();
          return true;
        }
      }
      return false;
    });
    if (clicked) await sleep(1200);
  } catch {
    /* ignore */
  }
}

/** SS360: скролл окна + низ списка в viewport, пока число li стабилизируется (подгрузка ~220+ позиций). */
async function scrollUntilSs360Stable(page, options = {}) {
  const maxRounds = options.maxRounds ?? 130;
  const stableNeeded = options.stableNeeded ?? 8;
  const pauseMs = options.pauseMs ?? 800;

  let lastCount = 0;
  let stable = 0;

  const countLocator = "#ss360-filtered-results ul.ss360-list.ss360-grid.ss360-grid--lg > li, #ss360-filtered-results ul.ss360-list.ss360-grid > li";

  for (let i = 0; i < maxRounds; i++) {
    await page.evaluate(() => {
      window.scrollBy(0, Math.min(5000, Math.max(1000, document.body.scrollHeight - window.innerHeight)));
      const ul = document.querySelector(
        "#ss360-filtered-results ul.ss360-list.ss360-grid.ss360-grid--lg, #ss360-filtered-results ul.ss360-list.ss360-grid"
      );
      if (ul) ul.scrollIntoView({ block: "end", inline: "nearest" });
    });
    await sleep(pauseMs);

    const count = await page.locator(countLocator).count();

    if (count === lastCount) {
      stable += 1;
      if (stable >= stableNeeded && lastCount > 0) break;
    } else {
      stable = 0;
      lastCount = count;
    }
  }
}

/**
 * Карточки Site Search 360 (выполняется в браузере).
 */
function ss360ListingCardsEvaluate() {
  const wrap = document.querySelector("#ss360-filtered-results");
  if (!wrap) return [];

  const list =
    wrap.querySelector("ul.ss360-list.ss360-grid.ss360-grid--lg") ||
    wrap.querySelector("ul.ss360-list.ss360-grid");
  if (!list) {
    const loose = Array.from(
      wrap.querySelectorAll(".ss360-group-products a[href*='/shop/'], .ss360-group-products a[href*='/invest/']")
    );
    if (loose.length === 0) return [];
    const seen = new Set();
    const out = [];
    loose.forEach((a) => {
      const href = (a.getAttribute("href") || "").trim().split("#")[0];
      if (!href || seen.has(href)) return;
      seen.add(href);
      const name = (a.getAttribute("title") || a.textContent || "").replace(/\s+/g, " ").trim();
      out.push({ name, href, code: null, price: null, stock: null });
    });
    return out;
  }

  let rowEls = Array.from(list.querySelectorAll(":scope > li"));
  if (rowEls.length === 0) {
    rowEls = Array.from(
      wrap.querySelectorAll(".ss360-group-products li, .ss360-section-products li, li.ss360-hit")
    );
  }

  return rowEls
    .map((li) => {
      if (!li || !li.querySelector) return { name: "", href: "", code: null, price: null, stock: null };
      let a =
        li.querySelector("a.ss360-hit__link[href]") ||
        li.querySelector(".ss360-hit__title a[href]") ||
        li.querySelector(".ss360-hit a[href*='/shop/'], .ss360-hit a[href*='/invest/'], .ss360-hit a[href*='/collect/']") ||
        li.querySelector("h2 a[href], h3 a[href], h4 a[href]");

      if (!a) {
        const candidates = li.querySelectorAll("a[href]");
        for (const x of candidates) {
          const h = (x.getAttribute("href") || "").trim();
          if (!h || h === "#" || /^javascript:/i.test(h)) continue;
          if (/search-results-page|#\/|mailto:|tel:/i.test(h)) continue;
          if (/\/(shop|invest|collect)\//.test(h) || /^\/[a-z-]+\/[a-z-]+\//i.test(h)) {
            a = x;
            break;
          }
        }
      }

      const href = (a && a.getAttribute("href") && a.getAttribute("href").trim().split("#")[0]) || "";
      let name = "";
      if (a) {
        const titleEl = li.querySelector(".ss360-hit__title, .ss360-hit__name");
        name =
          (a.getAttribute("title") || "").trim() ||
          (titleEl && titleEl.textContent.replace(/\s+/g, " ").trim()) ||
          a.textContent.replace(/\s+/g, " ").trim();
      }

      return { name, href, code: null, price: null, stock: null };
    })
    .filter((row) => row.href && !/^javascript:/i.test(row.href));
}

/**
 * Сырые карточки из DOM (выполняется в браузере).
 * Поддерживает data-product-title (актуальная вёрстка) и data-product-name (запасной вариант).
 */
function listingCardsEvaluate() {
  const root = document.querySelector("#productsView");
  if (!root) return [];

  const seen = new Set();
  const cards = root.querySelectorAll(".item-card, .product-card");
  const out = [];

  cards.forEach((card) => {
    if (seen.has(card)) return;
    seen.add(card);

    const a = card.querySelector("a.asset[href]");
    const href = a?.getAttribute("href")?.trim() || "";
    const name =
      card.getAttribute("data-product-title")?.trim() ||
      card.getAttribute("data-product-name")?.trim() ||
      a?.getAttribute("title")?.trim() ||
      "";

    const code = card.getAttribute("data-product-code")?.trim() || null;
    const price = card.getAttribute("data-product-price")?.trim() || null;
    const stock = card.getAttribute("data-product-stock")?.trim() || null;

    out.push({ name, href, code, price, stock });
  });

  return out;
}

function toAbsoluteUrl(href) {
  if (!href || href === "#") return null;
  return href.startsWith("http")
    ? href.split("#")[0]
    : ORIGIN.replace(/\/$/, "") + (href.startsWith("/") ? href : "/" + href);
}

/**
 * С листинга gold bullion часто отдаётся /shop/.../the-coin-slug/ — в headless даёт 404.
 * Рабочая PDP та же монета: /invest/bullion/bullion-coins/gold-coins/<slug>/
 */
function rewriteShopPdpToInvestGoldCoins(absUrl) {
  try {
    const u = new URL(absUrl);
    if (!/royalmint\.com$/i.test(u.hostname.replace(/^www\./, ""))) return absUrl;
    if (!u.pathname.includes("/shop/")) return absUrl;
    const slug = u.pathname.replace(/\/+$/, "").split("/").filter(Boolean).pop();
    if (!slug) return absUrl;
    u.pathname = `/invest/bullion/bullion-coins/gold-coins/${slug}/`;
    u.search = "?listId=Gold_Coins&listName=Gold%20Coins";
    return u.toString();
  } catch {
    return absUrl;
  }
}

/**
 * Аналогично золоту: /shop/.../slug/ → silver bullion PDP (в headless /shop/ часто 404).
 */
function rewriteShopPdpToInvestSilverCoins(absUrl) {
  try {
    const u = new URL(absUrl);
    if (!/royalmint\.com$/i.test(u.hostname.replace(/^www\./, ""))) return absUrl;
    if (!u.pathname.includes("/shop/")) return absUrl;
    const slug = u.pathname.replace(/\/+$/, "").split("/").filter(Boolean).pop();
    if (!slug) return absUrl;
    u.pathname = `/invest/bullion/bullion-coins/silver-coins/${slug}/`;
    u.search = "?listId=Silver_Coins&listName=Silver%20Coins";
    return u.toString();
  } catch {
    return absUrl;
  }
}

/**
 * Выбор invest-пути для /shop/ по URL (silver vs gold). Для листинга silver-поиска — preferSilver: true.
 */
function rewriteShopPdpToInvestBullion(absUrl, opts = {}) {
  const preferSilver = opts.preferSilver === true;
  const lower = String(absUrl).toLowerCase();
  if (!/\/shop\//.test(lower)) return absUrl;
  /**
   * Limited / commemorative / trial-of-the-pyx / наборы / monarch / world в /shop/... — не bullion:
   * тот же slug на invest/bullion/bullion-coins даёт 404.
   * Оставляем канонический shop URL (query убираем); страница обычно отдаётся нормально.
   */
  if (
    /\/commemorative\//i.test(lower) ||
    /\/limited-editions\//i.test(lower) ||
    /\/trial-of-the-pyx\//i.test(lower) ||
    /\/coin-sets\//i.test(lower) ||
    /\/shop\/monarch\//i.test(lower) ||
    /\/shop\/world\//i.test(lower)
  ) {
    try {
      const u = new URL(absUrl);
      u.search = "";
      return u.toString().replace(/\/+$/, "");
    } catch {
      return String(absUrl).split("?")[0].replace(/\/+$/, "");
    }
  }
  const goldish = /\bgold\b|1oz-gold|-gold-|\bsovereign\b/i.test(lower);
  const silverish = /\bsilver\b|1oz-silver|-silver-|britannia.*silver|maple.*silver/i.test(lower);
  if (goldish && !silverish) return rewriteShopPdpToInvestGoldCoins(absUrl);
  if (silverish && !goldish) return rewriteShopPdpToInvestSilverCoins(absUrl);
  if (preferSilver) return rewriteShopPdpToInvestSilverCoins(absUrl);
  return rewriteShopPdpToInvestGoldCoins(absUrl);
}

function listUrlIndicatesSilverSearch(listUrl) {
  try {
    const u = new URL(listUrl);
    return (u.searchParams.get("ss360Query") || "").toLowerCase() === "silver";
  } catch {
    return false;
  }
}

/**
 * Служебные / коллекционные слэбы: «Graded by NGC» и похожие (+ PCGS).
 * Подходит и для названия на листинге, и для склеенного текста с PDP (заголовок + описание + спеки).
 */
function textLooksLikeGradedSlab(text) {
  if (!text) return false;
  const n = String(text);
  return (
    /graded\s+by\s+ngc/i.test(n) ||
    /\bngc\s+graded\b/i.test(n) ||
    /certified\s+by\s+ngc/i.test(n) ||
    /\bngc[\s\u00AE]*certified\b/i.test(n) ||
    /graded\s+by\s+pcgs/i.test(n) ||
    /\bpcgs\s+graded\b/i.test(n) ||
    /certified\s+by\s+pcgs/i.test(n)
  );
}

/** Алиас для textLooksLikeGradedSlab */
const nameLooksLikeGradedSlab = textLooksLikeGradedSlab;

/** Упаковки «500 Coin Box» и т.п. (не одиночная монета). */
function textLooksLikeCoinBox(text) {
  if (!text) return false;
  return /coin\s+box/i.test(String(text));
}

/**
 * Уникальные товары; по умолчанию без «Tube», «The Best Value», «Coin Box», NGC/PCGS graded в названии.
 */
function normalizeProducts(
  raw,
  {
    skipTube = true,
    skipBestValue = true,
    skipCoinBox = true,
    skipGradedSlab = true,
    rewriteShopLinksToInvestGold = false,
    rewriteShopLinksToInvestBullion = false,
    shopBullionPreferSilver = false,
  } = {}
) {
  const seen = new Map();
  for (const row of raw) {
    const { name, href, code, price, stock } = row;
    let abs = toAbsoluteUrl(href);
    if (!abs) continue;
    if (rewriteShopLinksToInvestGold) abs = rewriteShopPdpToInvestGoldCoins(abs);
    else if (rewriteShopLinksToInvestBullion) abs = rewriteShopPdpToInvestBullion(abs, { preferSilver: shopBullionPreferSilver });
    if (skipTube && /tube/i.test(name || "")) continue;
    if (skipBestValue && /the\s+best\s+value/i.test(name || "")) continue;
    if (skipCoinBox && textLooksLikeCoinBox(name)) continue;
    if (skipGradedSlab && textLooksLikeGradedSlab(name)) continue;
    if (!seen.has(abs)) seen.set(abs, { url: abs, name: name || "", code, price, stock });
  }
  return [...seen.values()];
}

/** Сбор с страницы поиска SS360 (silver и др.). */
async function collectRoyalMintSs360Search(page, listUrl, scrollOptions = {}) {
  await applyRoyalMintPageHardening(page);

  const resolvedUrl = enrichSilverSearchUrlIfNeeded(listUrl);
  if (resolvedUrl !== listUrl) {
    console.log("SS360: к URL добавлены годы и сортировка (параметр year + high_-_low).");
    console.log("Загрузка:", resolvedUrl.slice(0, 120) + (resolvedUrl.length > 120 ? "…" : ""));
  }
  listUrl = resolvedUrl;

  const liSel =
    "#ss360-filtered-results ul.ss360-list.ss360-grid.ss360-grid--lg > li, #ss360-filtered-results ul.ss360-list.ss360-grid > li";
  const hydrateTimeout = scrollOptions.ss360HydrateTimeoutMs ?? 120000;

  async function runHydrationPass() {
    const respWatch = page
      .waitForResponse((res) => isLikelySs360Request(res.url()) && res.status() < 500, { timeout: 65000 })
      .catch(() => null);
    await page.goto(listUrl, { waitUntil: "domcontentloaded", timeout: 120000 });
    await respWatch;
    await sleep(1000);
    await acceptRoyalMintCookiebot(page);
    const ok = await waitForSs360ListingHydrated(page, hydrateTimeout);
    return ok;
  }

  let hydrated = await runHydrationPass();
  let nLi = await page.locator(liSel).count();
  if (!hydrated && nLi === 0) {
    console.log("SS360: повтор — перезагрузка страницы и снова ожидание выдачи…");
    const afterReload = page
      .waitForResponse((res) => isLikelySs360Request(res.url()) && res.status() < 500, { timeout: 65000 })
      .catch(() => null);
    await page.reload({ waitUntil: "domcontentloaded", timeout: 120000 });
    await afterReload;
    await sleep(1000);
    await acceptRoyalMintCookiebot(page);
    await waitForSs360ListingHydrated(page, Math.min(90000, hydrateTimeout));
    nLi = await page.locator(liSel).count();
  }

  for (let w = 0; w < 20; w++) {
    nLi = await page.locator(liSel).count();
    if (nLi > 0) break;
    await sleep(1000);
  }

  await sleep(800);

  await scrollUntilSs360Stable(page, scrollOptions);

  const raw = await page.evaluate(ss360ListingCardsEvaluate);
  const skipTube = scrollOptions.skipTube !== false;
  const skipBestValue = scrollOptions.skipBestValue !== false;
  const skipGradedSlab = scrollOptions.skipGradedSlab !== false;
  const skipCoinBox = scrollOptions.skipCoinBox !== false;
  const rewriteBullion = scrollOptions.rewriteShopLinksToInvestBullion !== false;
  const preferSilver = listUrlIndicatesSilverSearch(listUrl);

  const products = normalizeProducts(raw, {
    skipTube,
    skipBestValue,
    skipCoinBox,
    skipGradedSlab,
    rewriteShopLinksToInvestGold: false,
    rewriteShopLinksToInvestBullion: rewriteBullion,
    shopBullionPreferSilver: preferSilver,
  });

  return {
    listUrl,
    listingSource: "ss360",
    cardsInDom: raw.length,
    products,
    rawSample: raw.slice(0, 3),
  };
}

/** Сбор с PLP #productsView (gold bullion и аналоги). */
async function collectRoyalMintProductsView(page, listUrl, scrollOptions = {}) {
  await page.goto(listUrl, { waitUntil: "domcontentloaded", timeout: 120000 });
  await page.locator("#productsView").waitFor({ state: "visible", timeout: 90000 }).catch(() => {});
  await sleep(1500);

  await scrollUntilListingStable(page, scrollOptions);

  const raw = await page.evaluate(listingCardsEvaluate);
  const skipTube = scrollOptions.skipTube !== false;
  const skipBestValue = scrollOptions.skipBestValue !== false;
  const skipGradedSlab = scrollOptions.skipGradedSlab !== false;
  const skipCoinBox = scrollOptions.skipCoinBox !== false;
  const rewriteShop =
    scrollOptions.rewriteShopLinksToInvestGold !== false &&
    /gold-coins/i.test(String(listUrl));
  const products = normalizeProducts(raw, {
    skipTube,
    skipBestValue,
    skipCoinBox,
    skipGradedSlab,
    rewriteShopLinksToInvestGold: rewriteShop,
  });

  return {
    listUrl,
    listingSource: "plp",
    cardsInDom: raw.length,
    products,
    rawSample: raw.slice(0, 3),
  };
}

/**
 * Универсальная точка входа: PLP или search-results (Site Search 360).
 */
async function collectRoyalMintListing(page, listUrl = DEFAULT_GOLD_BULLION_LIST_URL, scrollOptions = {}) {
  if (isSs360SearchUrl(listUrl)) {
    return collectRoyalMintSs360Search(page, listUrl, scrollOptions);
  }
  return collectRoyalMintProductsView(page, listUrl, scrollOptions);
}

module.exports = {
  ORIGIN,
  DEFAULT_GOLD_BULLION_LIST_URL,
  SILVER_SEARCH_PAGE,
  DEFAULT_SILVER_SEARCH_URL,
  SILVER_SEARCH_YEAR_TAGS,
  buildSilverSearchUrlWithYears,
  enrichSilverSearchUrlIfNeeded,
  isSs360SearchUrl,
  collectRoyalMintListing,
  collectRoyalMintSs360Search,
  collectRoyalMintProductsView,
  scrollUntilListingStable,
  scrollUntilSs360Stable,
  normalizeProducts,
  listingCardsEvaluate,
  ss360ListingCardsEvaluate,
  rewriteShopPdpToInvestGoldCoins,
  rewriteShopPdpToInvestSilverCoins,
  rewriteShopPdpToInvestBullion,
  getRoyalMintChromiumLaunchOptions,
  getRoyalMintBrowserContextOptions,
  applyRoyalMintPageHardening,
  nameLooksLikeGradedSlab,
  textLooksLikeGradedSlab,
  textLooksLikeCoinBox,
};
