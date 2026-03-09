/**
 * Проверка реальных breadcrumb на разных страницах Perth Mint.
 *   node scripts/check-perth-breadcrumbs.js
 */
const fs = require("fs");
const path = require("path");

const SAMPLE_URLS = [
  "https://www.perthmint.com/shop/collector-coins/coins/deadly-and-dangerous-australias-giant-centipede-2026-1oz-silver-proof-coloured-coin/",
  "https://www.perthmint.com/shop/collector-coins/australian-kangaroo-2023-1-10oz-gold-proof-coin/",
  "https://www.perthmint.com/shop/collector-coins/coins/2018-australian-kangaroo-1oz-99.99-silver-pr-hr-coin/",
  "https://www.perthmint.com/shop/collector-coins/coins/australian-lunar-series-iii-2025-year-of-the-snake-1oz-silver-proof-coin/",
  "https://www.perthmint.com/shop/collector-coins/coins/australian-kookaburra-2018-1oz-silver-proof-coin/",
  "https://www.perthmint.com/shop/collector-coins/sovereigns/1914-king-george-v-perth-mint-gold-sovereign/",
  "https://www.perthmint.com/shop/collector-coins/coins/2018-year-of-the-dog-1oz-silver-gilded-edition/",
  "https://www.perthmint.com/shop/collector-coins/coins/sydney-anda-coin-show-special-australian-lunar-series-ii-2012-year-of-the-dragon-1oz-silver-coloured-edition/",
];

async function main() {
  const playwrightExtra = require("playwright-extra");
  const chromium = playwrightExtra.chromium;
  chromium.use(require("puppeteer-extra-plugin-stealth")());

  const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
  const page = await browser.newPage();
  page.setDefaultTimeout(25000);

  const results = [];
  for (let i = 0; i < SAMPLE_URLS.length; i++) {
    const url = SAMPLE_URLS[i];
    const slug = url.split("/").filter(Boolean).pop();
    process.stdout.write(`[${i + 1}/${SAMPLE_URLS.length}] ${slug.slice(0, 50)}… `);
    try {
      await page.goto(url, { waitUntil: "networkidle" });
      await page.waitForSelector("#pageMetadataObject", { timeout: 8000 }).catch(() => {});
      await page.waitForTimeout(3000);
      const meta = await page.evaluate(() => {
        const el = document.getElementById("pageMetadataObject");
        if (!el) return null;
        try {
          return JSON.parse(el.textContent);
        } catch (e) {
          return null;
        }
      });
      const bc = meta?.breadcrumb;
      results.push({ url: slug, breadcrumb: bc || "NOT FOUND", title: meta?.title });
      console.log("bc:", JSON.stringify(bc));
    } catch (e) {
      results.push({ url: slug, error: e.message });
      console.log("err:", e.message);
    }
    await new Promise((r) => setTimeout(r, 500));
  }

  await browser.close();

  fs.writeFileSync(
    path.join(__dirname, "..", "data", "perth-breadcrumb-samples.json"),
    JSON.stringify(results, null, 2)
  );
  console.log("\nСохранено в data/perth-breadcrumb-samples.json");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
