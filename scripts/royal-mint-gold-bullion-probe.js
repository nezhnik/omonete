/**
 * Проба парсинга листинга золотых bullion The Royal Mint (инфинити-скролл).
 * https://www.royalmint.com/invest/bullion/bullion-coins/gold-coins
 *
 * Вёрстка (см. DevTools): #productsView.row → карточки .item-card / .product-card → a.asset[href];
 * data-product-title, data-product-code (общая логика в royal-mint-listing-collect.js).
 * Пропускаем позиции с «Tube», «The Best Value», «Coin Box», NGC/PCGS graded в названии (royal-mint-listing-collect.js).
 *
 * Запуск:
 *   node scripts/royal-mint-gold-bullion-probe.js
 *   node scripts/royal-mint-gold-bullion-probe.js --one
 */
const fs = require("fs");
const path = require("path");
const { collectRoyalMintListing, DEFAULT_GOLD_BULLION_LIST_URL } = require("./royal-mint-listing-collect.js");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function probeProductPage(page, url) {
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 120000 });
  await sleep(1500);
  const data = await page.evaluate(() => {
    const ogImage = document.querySelector('meta[property="og:image"]')?.getAttribute("content") || "";
    const title = document.querySelector("h1")?.textContent?.trim() || document.title || "";
    const imgs = Array.from(document.querySelectorAll('img[src*="royalmint"], img[srcset*="royalmint"]'))
      .map((img) => img.src || img.getAttribute("data-src") || "")
      .filter(Boolean);
    return { title, ogImage, sampleImages: [...new Set(imgs)].slice(0, 12) };
  });
  return { url, ...data };
}

async function main() {
  const { chromium } = require("playwright");
  const one = process.argv.includes("--one");
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    locale: "en-GB",
  });
  const page = await context.newPage();

  try {
    const { cardsInDom, products } = await collectRoyalMintListing(page, DEFAULT_GOLD_BULLION_LIST_URL, {
      maxRounds: 80,
      stableNeeded: 5,
    });
    console.log("Карточек в DOM (включая Tube и дубли по скроллу):", cardsInDom);
    console.log("Уникальных продуктов (без Tube, «The Best Value», «Coin Box», NGC/PCGS graded в названии):", products.length);
    products.slice(0, 15).forEach((p, i) => {
      const meta = [p.code ? `code=${p.code}` : null, p.price ? `£${p.price}` : null, p.stock ? p.stock : null]
        .filter(Boolean)
        .join(" · ");
      console.log(`  ${i + 1}. ${(p.name || "").slice(0, 70)}${meta ? " (" + meta + ")" : ""}\n     ${p.url}`);
    });

    if (one && products.length > 0) {
      const first = products[0];
      console.log("\n--- Проба карточки (первая после фильтров) ---\n", first.url);
      const detail = await probeProductPage(page, first.url);
      const outPath = path.join(__dirname, "..", "data", "royal-mint-probe-one.json");
      fs.mkdirSync(path.dirname(outPath), { recursive: true });
      fs.writeFileSync(outPath, JSON.stringify({ listingCount: products.length, first, detail }, null, 2), "utf8");
      console.log("Сохранено:", outPath);
    }
  } finally {
    await browser.close();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
