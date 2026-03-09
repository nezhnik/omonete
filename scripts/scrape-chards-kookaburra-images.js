/**
 * Скрейпит Kookaburra с сайта Chards:
 *  - страница списка: https://www.chards.co.uk/category/buy-coins/a/silver/kookaburra/australia
 *  - для каждой карточки заходит на страницу товара;
 *  - в блоке aria-label="Image Carousel" берёт ПЕРВЫЕ ДВЕ картинки:
 *      1) reverse (реверс)
 *      2) obverse (аверс)
 *    третью "под углом" сознательно пропускаем;
 *  - скачивает их, конвертирует в webp и сохраняет в
 *    public/image/coins/chards-kookaburra;
 *  - складывает базовый JSON с информацией по монетам в
 *    data/chards-kookaburra-raw.json (для дальнейшей ручной/авто обработки).
 *
 * Существующие каноники/БД не трогаем — это отдельный подготовительный шаг.
 *
 * Запуск:
 *   node scripts/scrape-chards-kookaburra-images.js --limit=0
 *   (limit>0 можно использовать, чтобы протестировать на нескольких монетах)
 */

/* eslint-disable no-console */

const fs = require("fs");
const path = require("path");
const sharp = require("sharp");

const ROOT_URL =
  "https://www.chards.co.uk/category/buy-coins/a/silver/kookaburra/australia";
const PRODUCT_BASE = "https://www.chards.co.uk";

const PROJECT_ROOT = path.join(__dirname, "..");
const DATA_DIR = path.join(PROJECT_ROOT, "data");
const PUBLIC_DIR = path.join(PROJECT_ROOT, "public");
const OUT_DIR = path.join(PUBLIC_DIR, "image", "coins", "chards-kookaburra");
const OUT_JSON = path.join(DATA_DIR, "chards-kookaburra-raw.json");

const MAX_SIDE = 1200;

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function normalizeUrl(u) {
  if (!u) return null;
  let url = String(u);
  if (url.startsWith("//")) url = `https:${url}`;
  if (url.startsWith("/")) url = PRODUCT_BASE + url;
  if (!url.startsWith("http")) return null;
  return url;
}

function slugFromProductUrl(url) {
  try {
    const u = new URL(url);
    const segments = u.pathname.split("/").filter(Boolean);
    if (segments.length === 0) return "chards-coin";
    const namePart = segments[segments.length - 2] || segments[segments.length - 1];
    const idPart = segments[segments.length - 1];
    const raw = `chards-${namePart}-${idPart}`;
    return raw
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "");
  } catch {
    return "chards-coin";
  }
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

async function getAllProductUrls(page) {
  const urls = new Set();
  let pageIndex = 1;

  // крутим страницы, пока есть активная ссылка Next
  // (на момент написания: 86 монет, 36 на страницу → 3 страницы)
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
        .filter(Boolean)
        .filter((h) => /kookaburra/i.test(h));

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
      `  Найдено ссылок на этой странице: ${result.hrefs.length}, всего уникальных: ${urls.size}`
    );

    if (!result.hasNext) break;
    pageIndex += 1;
  }

  return Array.from(urls);
}

async function scrapeImagesForProduct(page, productUrl) {
  await page.goto(productUrl, { waitUntil: "domcontentloaded", timeout: 45000 });
  await page.waitForTimeout(1500);

  const imgs = await page.evaluate(() => {
    const root =
      document.querySelector('[aria-label="Image Carousel"]') || document;
    const list = Array.from(root.querySelectorAll("img"));
    const urls = list
      .map((img) => img.getAttribute("data-src") || img.getAttribute("src"))
      .filter(Boolean);
    // убираем дубли
    return Array.from(new Set(urls));
  });

  if (!imgs.length) {
    console.log("  ! нет картинок в карусели");
    return { reverseUrl: null, obverseUrl: null, all: [] };
  }

  const normalized = imgs
    .map((u) => normalizeUrl(u))
    .filter(Boolean);

  const reverseUrl = normalized[0] || null;
  const obverseUrl = normalized[1] || null;

  return { reverseUrl, obverseUrl, all: normalized };
}

async function main() {
  ensureDir(OUT_DIR);
  ensureDir(DATA_DIR);

  const limitArg = process.argv.find((a) => a.startsWith("--limit="));
  const limit = limitArg ? parseInt(limitArg.split("=")[1], 10) || 0 : 0;

  let chromium;
  try {
    // переиспользуем связку playwright-extra + stealth, как для Perth
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
    const productUrls = await getAllProductUrls(page);
    console.log(`\nВсего найдено товаров: ${productUrls.length}`);

    const targetUrls =
      limit > 0 ? productUrls.slice(0, limit) : productUrls.slice();

    const out = [];
    let processed = 0;

    for (const productUrl of targetUrls) {
      processed += 1;
      console.log(`\n[${processed}/${targetUrls.length}] ${productUrl}`);
      try {
        // eslint-disable-next-line no-await-in-loop
        const { reverseUrl, obverseUrl, all } = await scrapeImagesForProduct(
          page,
          productUrl
        );

        const slug = slugFromProductUrl(productUrl);

        const entry = {
          productUrl,
          slug,
          images: {
            reverse: null,
            obverse: null,
          },
          rawUrls: all,
        };

        if (reverseUrl) {
          const dest = path.join(OUT_DIR, `${slug}-rev.webp`);
          const rel = `/image/coins/chards-kookaburra/${slug}-rev.webp`;
          // eslint-disable-next-line no-await-in-loop
          const ok = await downloadToWebp(reverseUrl, dest);
          if (ok) {
            entry.images.reverse = rel;
            console.log("  ✓ reverse:", rel);
          }
        }

        if (obverseUrl) {
          const dest = path.join(OUT_DIR, `${slug}-obv.webp`);
          const rel = `/image/coins/chards-kookaburra/${slug}-obv.webp`;
          // eslint-disable-next-line no-await-in-loop
          const ok = await downloadToWebp(obverseUrl, dest);
          if (ok) {
            entry.images.obverse = rel;
            console.log("  ✓ obverse:", rel);
          }
        }

        out.push(entry);
        // небольшая пауза, чтобы не долбить сайт
        // eslint-disable-next-line no-await-in-loop
        await new Promise((res) => setTimeout(res, 600));
      } catch (e) {
        console.log("  ! ошибка при обработке товара:", e.message || e);
      }
    }

    fs.writeFileSync(OUT_JSON, JSON.stringify(out, null, 2), "utf8");
    console.log(
      `\nГотово. Сохранено записей: ${out.length}. JSON: ${OUT_JSON}`
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

