/**
 * Скрейпит монеты Kookaburra с SD Bullion:
 *   https://sdbullion.com/catalogsearch/result/index/?product_list_limit=50&q=kookaburra
 *
 * Цели:
 *  - пройтись по всем страницам поиска (126 карточек);
 *  - для КАЖДОЙ карточки определить год и вес (1 oz / 2 oz / 10 oz / 1 kg);
 *  - сравнить с KOOKABURRA_SERIES_PLAN.md:
 *      - берём ТОЛЬКО те комбинации (год + вес), у которых has_images пустой;
 *  - на странице товара:
 *      - собираем картинки из thumbnail‑карусели;
 *      - игнорируем "side" снимки (url/alt содержит "side");
 *      - берём reverse и obverse (по ключевым словам, иначе по порядку);
 *  - скачиваем их в webp:
 *      public/image/coins/sdb-kookaburra/<slug>-rev.webp / -obv.webp
 *  - сохраняем сырую информацию в data/sdb-kookaburra-raw.json
 *    (НЕ меняем KOOKABURRA_SERIES_PLAN.md — это отдельный шаг).
 *
 * Запуск:
 *   node scripts/scrape-sdbullion-kookaburra-images.js --limit=0
 *   (limit>0 — ограничить кол-во товаров для теста)
 */

/* eslint-disable no-console */

const fs = require("fs");
const path = require("path");
const sharp = require("sharp");

const SEARCH_ROOT =
  "https://sdbullion.com/catalogsearch/result/index/?product_list_limit=50&q=kookaburra";

const PROJECT_ROOT = path.join(__dirname, "..");
const DATA_DIR = path.join(PROJECT_ROOT, "data");
const PUBLIC_DIR = path.join(PROJECT_ROOT, "public");
const OUT_DIR = path.join(PUBLIC_DIR, "image", "coins", "sdb-kookaburra");
const OUT_JSON = path.join(DATA_DIR, "sdb-kookaburra-raw.json");

const PLAN_PATH = path.join(
  "/Users/mihail/Desktop/В IT работа",
  "documentation-backup",
  "important-documentation",
  "KOOKABURRA_SERIES_PLAN.md"
);

const MAX_SIDE = 1200;

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function detectWeightKeyFromTitle(title) {
  const t = String(title).toLowerCase();
  if (t.includes("kilo") || t.includes("kilogram") || t.includes("1 kg")) {
    return "1kg";
  }
  if (t.includes("10 oz") || t.includes("10oz")) return "10oz";
  if (t.includes("2 oz") || t.includes("2oz")) return "2oz";
  if (t.includes("1 oz") || t.includes("1oz")) return "1oz";
  return null;
}

function detectYear(str) {
  const m = String(str).match(/(19|20)\d{2}/);
  return m ? parseInt(m[0], 10) : null;
}

function loadMissingKeysFromPlan() {
  if (!fs.existsSync(PLAN_PATH)) {
    console.log("Не найден KOOKABURRA_SERIES_PLAN.md, вернём пустой список.");
    return new Set();
  }
  const text = fs.readFileSync(PLAN_PATH, "utf8");
  const lines = text.split(/\r?\n/);

  const weightKeyByType = {
    "regular-1oz": "1oz",
    "regular-2oz": "2oz",
    "regular-10oz": "10oz",
    "regular-1kg": "1kg",
  };

  const missing = new Set();

  for (const line of lines) {
    if (!line.startsWith("|")) continue;
    if (line.startsWith("| year") || line.startsWith("|------")) continue;

    const cells = line
      .split("|")
      .slice(1, -1)
      .map((c) => c.trim());

    if (cells.length !== 16) continue;

    const [yearStr, type, variant] = cells;
    const hasImages = cells[13];
    const weightKey = weightKeyByType[type];
    const year = parseInt(yearStr, 10);

    if (!weightKey || Number.isNaN(year)) continue;
    if (variant) continue; // privy / спец-выпуски сейчас обрабатываем отдельно
    if (hasImages) continue; // уже есть картинки

    missing.add(`${weightKey}-${year}`);
  }

  return missing;
}

async function downloadToWebp(imgUrl, destPath) {
  const res = await fetch(imgUrl, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0 Safari/537.36",
    },
    redirect: "follow",
  });
  if (!res.ok) {
    console.log("  ! download failed:", imgUrl, res.status);
    return false;
  }
  const buf = Buffer.from(await res.arrayBuffer());
  if (!buf.length) {
    console.log("  ! empty buffer:", imgUrl);
    return false;
  }
  await sharp(buf)
    .resize(MAX_SIDE, MAX_SIDE, { fit: "inside", withoutEnlargement: true })
    .webp({ quality: 82, effort: 6, smartSubsample: true })
    .toFile(destPath);
  return true;
}

function slugFromProductUrl(url) {
  try {
    const u = new URL(url);
    const segments = u.pathname.split("/").filter(Boolean);
    const last = segments[segments.length - 1] || "kookaburra-coin";
    const raw = last;
    return raw
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "");
  } catch {
    return "kookaburra-coin";
  }
}

async function collectProductUrls(page) {
  const urls = new Set();
  let pageIndex = 1;

  // крутим, пока есть страница с товарами
  /* eslint-disable no-constant-condition */
  while (true) {
    const url =
      pageIndex === 1 ? SEARCH_ROOT : `${SEARCH_ROOT}&p=${pageIndex}`;
    console.log(`Страница поиска ${pageIndex}: ${url}`);
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 });
    await page.waitForTimeout(2000);

    const { hrefs, hasNext } = await page.evaluate(() => {
      const grid = document.querySelector(
        "div.products.wrapper.mode-grid.products-grid"
      );
      const scope = grid || document;
      const cards = Array.from(scope.querySelectorAll("a[href]"));

      const hrefsInner = cards
        .map((a) => a.getAttribute("href"))
        .filter(Boolean)
        .filter((h) => /kookaburra/i.test(h));

      const pager = document.querySelector(
        "div.flex.justify-between.gap-2.items-center"
      );
      let hasNextInner = false;
      if (pager) {
        const nextLink = Array.from(pager.querySelectorAll("a, button")).find(
          (el) => {
            const txt = (el.textContent || "").trim();
            return /next/i.test(txt);
          }
        );
        if (nextLink) hasNextInner = true;
      }

      return { hrefs: hrefsInner, hasNext: hasNextInner };
    });

    hrefs.forEach((h) => urls.add(h));
    console.log(
      `  Найдено href на странице: ${hrefs.length}, всего уникальных: ${urls.size}`
    );

    if (!hasNext) break;
    pageIndex += 1;
  }

  return Array.from(urls);
}

async function scrapeProduct(page, productUrl) {
  await page.goto(productUrl, { waitUntil: "domcontentloaded", timeout: 45000 });
  await page.waitForTimeout(2000);

  // Заголовок с годом и весом
  const title = await page
    .locator("h1, h2.page-title")
    .first()
    .textContent()
    .catch(() => "");

  const weightKey = detectWeightKeyFromTitle(title);
  const year = detectYear(title) || detectYear(productUrl);

  // Картинки из thumbnail‑карусели
  const imgs = await page.evaluate(() => {
    const root =
      document.querySelector("[id*='thumbnail-carousel']") ||
      document.querySelector(".thumbnail-carousel") ||
      document;
    const list = Array.from(root.querySelectorAll("img"));
    return list.map((img) => ({
      src:
        img.getAttribute("data-src") ||
        img.getAttribute("src") ||
        img.currentSrc ||
        "",
      alt: img.getAttribute("alt") || "",
    }));
  });

  const normalized = [];
  for (const { src, alt } of imgs) {
    if (!src) continue;
    const lowerSrc = src.toLowerCase();
    const lowerAlt = alt.toLowerCase();
    // отбрасываем изображения с угловым ракурсом / side
    if (lowerSrc.includes("side") || lowerAlt.includes("side")) continue;
    let url = src;
    if (url.startsWith("//")) url = `https:${url}`;
    if (url.startsWith("/")) url = `https://sdbullion.com${url}`;
    if (!url.startsWith("http")) continue;
    normalized.push({ url, alt: lowerAlt, src: lowerSrc });
  }

  if (!normalized.length) {
    return { year, weightKey, reverseUrl: null, obverseUrl: null, all: [] };
  }

  // Определим reverse / obverse
  let reverseUrl = null;
  let obverseUrl = null;

  for (const item of normalized) {
    const text = `${item.url} ${item.alt} ${item.src}`;
    const lower = text.toLowerCase();
    if (!reverseUrl && lower.includes("reverse")) {
      reverseUrl = item.url;
    } else if (!obverseUrl && lower.includes("obverse")) {
      obverseUrl = item.url;
    }
  }

  // если по словам не нашли — берём по порядку
  if (!reverseUrl) reverseUrl = normalized[0].url;
  if (!obverseUrl && normalized[1]) obverseUrl = normalized[1].url;

  return {
    year,
    weightKey,
    reverseUrl,
    obverseUrl,
    all: normalized.map((i) => i.url),
    title,
  };
}

async function main() {
  ensureDir(OUT_DIR);
  ensureDir(DATA_DIR);

  const missingKeys = loadMissingKeysFromPlan();
  console.log("Комбинаций (weight-year) без картинок в плане:", missingKeys.size);

  const limitArg = process.argv.find((a) => a.startsWith("--limit="));
  const limit = limitArg ? parseInt(limitArg.split("=")[1], 10) || 0 : 0;

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

  const out = [];
  let usedCount = 0;

  try {
    const productUrls = await collectProductUrls(page);
    console.log(`\nВсего найдено товаров на SD Bullion: ${productUrls.length}`);

    const targetUrls =
      limit > 0 ? productUrls.slice(0, limit) : productUrls.slice();

    let processed = 0;

    for (const productUrl of targetUrls) {
      processed += 1;
      console.log(`\n[${processed}/${targetUrls.length}] ${productUrl}`);
      try {
        // eslint-disable-next-line no-await-in-loop
        const { year, weightKey, reverseUrl, obverseUrl, all, title } =
          await scrapeProduct(page, productUrl);

        if (!year || !weightKey) {
          console.log("  ! не удалось определить год или вес, пропускаем");
          continue;
        }

        const key = `${weightKey}-${year}`;
        if (!missingKeys.has(key)) {
          console.log(
            `  → у нас уже есть картинки для ${key} в плане, пропускаем`
          );
          continue;
        }

        if (!reverseUrl || !obverseUrl) {
          console.log("  ! нет пары reverse/obverse, пропускаем");
          continue;
        }

        const slug = slugFromProductUrl(productUrl);
        const entry = {
          productUrl,
          slug,
          year,
          weightKey,
          title,
          images: {
            reverse: null,
            obverse: null,
          },
          rawUrls: all,
        };

        const revDest = path.join(OUT_DIR, `${slug}-rev.webp`);
        const revRel = `/image/coins/sdb-kookaburra/${slug}-rev.webp`;
        // eslint-disable-next-line no-await-in-loop
        const okRev = await downloadToWebp(reverseUrl, revDest);
        if (okRev) {
          entry.images.reverse = revRel;
          console.log("  ✓ reverse:", revRel);
        }

        const obvDest = path.join(OUT_DIR, `${slug}-obv.webp`);
        const obvRel = `/image/coins/sdb-kookaburra/${slug}-obv.webp`;
        // eslint-disable-next-line no-await-in-loop
        const okObv = await downloadToWebp(observeUrl ?? obverseUrl, obvDest);
        if (okObv) {
          entry.images.obverse = obvRel;
          console.log("  ✓ obverse:", obvRel);
        }

        if (entry.images.reverse && entry.images.obverse) {
          out.push(entry);
          usedCount += 1;
        }

        // eslint-disable-next-line no-await-in-loop
        await new Promise((res) => setTimeout(res, 700));
      } catch (e) {
        console.log("  ! ошибка при обработке товара:", e.message || e);
      }
    }

    fs.writeFileSync(OUT_JSON, JSON.stringify(out, null, 2), "utf8");
    console.log(
      `\nГотово. Новых записей (по монетам, где картинок не было): ${usedCount}. JSON: ${OUT_JSON}`
    );
  } finally {
    await page.close();
    await browser.close();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

