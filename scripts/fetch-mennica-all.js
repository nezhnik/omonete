/**
 * Массовый парсинг Mennica: data/mennica-listing-products.json (после mennica:listing).
 * Один браузер, по очереди PDP.
 *
 *   npm run mennica:fetch:all
 *   npm run mennica:fetch:missing   — только те, для кого ещё нет data/mennica-<slug>.json
 *
 * Флаги:
 *   node scripts/fetch-mennica-all.js --only-missing
 *   node scripts/fetch-mennica-all.js --refetch-duplicate-images
 *     — только карточки, где в JSON obverse/reverse указывают на один снимок (разные размеры WooCommerce)
 */
const fs = require("fs");
const path = require("path");
const { parseMennicaProduct, normalizeUrl, slugFromUrl, mergeSpecsFromPlain } = require("./fetch-mennica-product.js");

const DATA_DIR = path.join(__dirname, "..", "data");
const LISTING_JSON = path.join(DATA_DIR, "mennica-listing-products.json");

function normalizeMennicaImgCanon(u) {
  if (!u || typeof u !== "string") return "";
  return u.split("?")[0].toLowerCase().replace(/-\d+x\d+(?=\.[^.]+)/gi, "");
}

function jsonHasDuplicateObverseReverse(raw) {
  const o = raw?.classified?.obverse;
  const r = raw?.classified?.reverse;
  if (!o || !r || !/^https?:\/\//i.test(o) || !/^https?:\/\//i.test(r)) return false;
  return normalizeMennicaImgCanon(o) === normalizeMennicaImgCanon(r);
}

async function acceptCookies(page) {
  const sels = [
    "button#onetrust-accept-btn-handler",
    "button:has-text('Accept')",
    "button:has-text('Akceptuję')",
  ];
  for (const sel of sels) {
    const el = page.locator(sel).first();
    if (await el.isVisible().catch(() => false)) {
      await el.click({ timeout: 2000 }).catch(() => {});
      await page.waitForTimeout(400);
      return;
    }
  }
}

async function main() {
  const onlyMissing = process.argv.includes("--only-missing");
  const refetchDuplicates = process.argv.includes("--refetch-duplicate-images");

  if (!fs.existsSync(LISTING_JSON)) {
    console.error("Нет", LISTING_JSON, "— сначала npm run mennica:listing");
    process.exit(1);
  }
  const items = JSON.parse(fs.readFileSync(LISTING_JSON, "utf8"));
  if (!Array.isArray(items) || !items.length) {
    console.error("Пустой листинг");
    process.exit(1);
  }

  const byUrl = new Map();
  for (const row of items) {
    const u = normalizeUrl(row.url);
    if (!u) continue;
    if (!byUrl.has(u)) byUrl.set(u, row);
  }
  let list = Array.from(byUrl.values());

  if (onlyMissing) {
    const before = list.length;
    list = list.filter((row) => {
      const slug = slugFromUrl(row.url);
      const outFile = path.join(DATA_DIR, `mennica-${slug}.json`);
      return !fs.existsSync(outFile);
    });
    console.log(
      "Режим --only-missing: в листинге",
      before,
      "— без файла на диске:",
      list.length,
      "(пропускаем уже скачанные)"
    );
    if (!list.length) {
      console.log("Нечего парсить.");
      return;
    }
  }

  if (refetchDuplicates) {
    const before = list.length;
    list = list.filter((row) => {
      const slug = slugFromUrl(row.url);
      const fp = path.join(DATA_DIR, `mennica-${slug}.json`);
      if (!fs.existsSync(fp)) return false;
      try {
        const raw = JSON.parse(fs.readFileSync(fp, "utf8"));
        return jsonHasDuplicateObverseReverse(raw);
      } catch {
        return false;
      }
    });
    console.log(
      "Режим --refetch-duplicate-images: в листинге",
      before,
      "— дубль obv/rev в JSON:",
      list.length
    );
    if (!list.length) {
      console.log("Нечего перепарсить (дублей не найдено).");
      return;
    }
  }

  const { chromium } = require("playwright-extra");
  const StealthPlugin = require("puppeteer-extra-plugin-stealth");
  chromium.use(StealthPlugin());
  const browser = await chromium.launch({ headless: process.env.HEADLESS !== "0", args: ["--no-sandbox"] });
  const context = await browser.newContext({
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    locale: "en-GB",
    viewport: { width: 1366, height: 900 },
  });
  const page = await context.newPage();

  let ok = 0;
  let fail = 0;
  try {
    for (let i = 0; i < list.length; i++) {
      const row = list[i];
      const sourceUrl = row.url;
      const listingMeta = { listing_url: row.listing_url || null, listing_label: row.listing_label || null };
      console.log(`[${i + 1}/${list.length}] ${sourceUrl}`);
      try {
        await page.goto(sourceUrl, { waitUntil: "networkidle", timeout: 90000 });
        if (i === 0) await acceptCookies(page);
        await page
          .waitForSelector(".product-information-content .content-item, .woocommerce-tabs, h1.product_title", {
            timeout: 20000,
          })
          .catch(() => {});
        await page.waitForTimeout(800);
        let parsed = await parseMennicaProduct(page, sourceUrl, listingMeta);
        if (!parsed.listing_label && row.listing_label) parsed.listing_label = row.listing_label;
        if (!parsed.listing_url && row.listing_url) parsed.listing_url = row.listing_url;
        mergeSpecsFromPlain(parsed.specs, parsed.descriptionPlain);
        for (const t of Object.values(parsed.tabsPlain || {})) mergeSpecsFromPlain(parsed.specs, t);

        const slug = slugFromUrl(sourceUrl);
        const outFile = path.join(DATA_DIR, `mennica-${slug}.json`);
        fs.writeFileSync(outFile, JSON.stringify(parsed, null, 2), "utf8");
        console.log("  →", outFile, parsed.title || "—");
        ok++;
      } catch (e) {
        console.error(e);
        fail++;
      }
    }
  } finally {
    await browser.close();
  }

  console.log("Готово. Успешно:", ok, "Ошибок:", fail);
  console.log("Далее: npm run mennica:import && npm run data:export:incremental");
  if (fail > 0) process.exitCode = 1;
}

if (require.main === module) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
