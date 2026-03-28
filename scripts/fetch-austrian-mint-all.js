/**
 * Массовый парсинг Münze Österreich: data/austrian-mint-listing-products.json (после austrian-mint:listing).
 *
 *   npm run austrian-mint:fetch:all
 *   npm run austrian-mint:fetch:missing   — только без data/austrian-mint-<slug>.json
 *
 * Флаги:
 *   node scripts/fetch-austrian-mint-all.js --only-missing
 */
const fs = require("fs");
const path = require("path");
const { parseAustrianMintProduct, normalizeUrl, slugFromUrl } = require("./fetch-austrian-mint-product.js");

const DATA_DIR = path.join(__dirname, "..", "data");
const LISTING_JSON = path.join(DATA_DIR, "austrian-mint-listing-products.json");

async function main() {
  const onlyMissing = process.argv.includes("--only-missing");

  if (!fs.existsSync(LISTING_JSON)) {
    console.error("Нет", LISTING_JSON, "— сначала npm run austrian-mint:listing");
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
      const outFile = path.join(DATA_DIR, `austrian-mint-${slug}.json`);
      return !fs.existsSync(outFile);
    });
    console.log(
      "Режим --only-missing: в листинге",
      before,
      "— без файла на диске:",
      list.length
    );
    if (!list.length) {
      console.log("Нечего парсить.");
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
        await page.goto(sourceUrl, { waitUntil: "networkidle", timeout: 120000 });
        await page.waitForSelector("h1, .gallery-wrapper, .article-accordion-item", { timeout: 25000 }).catch(() => {});
        await page.waitForTimeout(600);
        let parsed = await parseAustrianMintProduct(page, sourceUrl, listingMeta);
        if (!parsed.listing_label && row.listing_label) parsed.listing_label = row.listing_label;
        if (!parsed.listing_url && row.listing_url) parsed.listing_url = row.listing_url;

        const slug = slugFromUrl(sourceUrl);
        const outFile = path.join(DATA_DIR, `austrian-mint-${slug}.json`);
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
  if (fail > 0) process.exitCode = 1;
}

if (require.main === module) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
