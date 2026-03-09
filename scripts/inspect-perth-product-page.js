/**
 * Сохраняет HTML одной страницы товара Perth для анализа (хлебные крошки, серия).
 *   node scripts/inspect-perth-product-page.js [url]
 */
const fs = require("fs");
const path = require("path");

async function main() {
  const url = process.argv[2] || "https://www.perthmint.com/shop/collector-coins/coins/1914-king-george-v-perth-mint-gold-sovereign/";
  let chromium;
  try {
    const playwrightExtra = require("playwright-extra");
    chromium = playwrightExtra.chromium;
    chromium.use(require("puppeteer-extra-plugin-stealth")());
  } catch (e) {
    console.error("playwright-extra, puppeteer-extra-plugin-stealth");
    process.exit(1);
  }
  const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
  const page = await browser.newPage();
  await page.goto(url, { waitUntil: "load", timeout: 30000 });
  await page.waitForTimeout(3000);
  const info = await page.evaluate(() => {
    const res = {};
    const metaEl = document.getElementById("pageMetadataObject");
    if (metaEl) {
      try {
        res.pageMetadata = JSON.parse(metaEl.textContent);
      } catch (e) {}
    }
    const bc = document.getElementById("pageBreadcrumb");
    if (bc) {
      res.breadcrumbEl = bc.innerHTML?.slice(0, 500);
      const items = Array.from(bc.querySelectorAll("a, li")).map((el) => (el.textContent || "").trim()).filter(Boolean);
      res.breadcrumbLinks = Array.from(bc.querySelectorAll("a[href]")).map((a) => ({ text: a.textContent.trim(), href: a.getAttribute("href") }));
    }
    const specs = {};
    document.querySelectorAll("table tr").forEach((tr) => {
      const th = tr.querySelector("th, td:first-child");
      const td = tr.querySelector("td:last-child, td:nth-child(2)");
      if (th && td) specs[(th.textContent || "").trim()] = (td.textContent || "").trim();
    });
    res.specs = specs;
    res.title = (document.querySelector("h1") || {}).textContent?.trim();
    return res;
  });
  await browser.close();
  console.log(JSON.stringify(info, null, 2));
  fs.writeFileSync(path.join(__dirname, "..", "data", "perth-product-inspect.json"), JSON.stringify(info, null, 2));
  console.log("\nСохранено в data/perth-product-inspect.json");
}

main().catch((e) => { console.error(e); process.exit(1); });
