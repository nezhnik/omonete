/**
 * Одноразовая проверка: 10 карточек PAMP — тираж в таблице specs, в .product-description__text, ключевое слово mintage.
 *   node scripts/pamp-10-mintage-smoke.js
 */
const { launchPampBrowser, parsePampProductPageLight } = require("./fetch-pamp-product.js");
const { extractPampMintagePhraseFromPlainText } = require("./parsing-mintage-constants.js");

const ROWS = [
  ["6745", "https://www.pamp.com/product/collectible/15oz-silver-roulette-wheel-spinning-coin"],
  ["6746", "https://www.pamp.com/product/collectible/1g-gold-bar-barbietm-valentines-day"],
  ["6747", "https://www.pamp.com/product/collectible/1g-gold-bar-coca-colar-love"],
  ["6748", "https://www.pamp.com/product/collectible/1g-pure-gold-bar-hot-wheelstm-race-win"],
  ["6750", "https://www.pamp.com/product/collectible/1oz-pure-silver-animals-africa-black-rhino-shaped-coin"],
  ["6751", "https://www.pamp.com/product/collectible/1oz-pure-silver-bar-buddha"],
  ["6752", "https://www.pamp.com/product/collectible/1oz-pure-silver-bar-diwali-lakshmi-rangoli-art"],
  ["6753", "https://www.pamp.com/product/collectible/1oz-pure-silver-bar-star-david"],
  ["6754", "https://www.pamp.com/product/collectible/1oz-pure-silver-fenderr-stratocasterr-surf-green-shaped-coin"],
  ["6755", "https://www.pamp.com/product/collectible/1oz-pure-silver-holiday-santa-coin"],
];

async function main() {
  const { browser, page, gqlCapture } = await launchPampBrowser();
  const out = [];
  try {
    for (const [coinId, url] of ROWS) {
      const { specs, title } = await parsePampProductPageLight(page, gqlCapture, url);
      const dom = await page.evaluate(() => {
        const text = (el) => (el && (el.innerText || el.textContent) ? String(el.innerText || el.textContent).trim() : "");
        const desc = text(document.querySelector(".product-description__text"));
        const props = text(document.querySelector(".product-description__product-properties"));
        const wide = text(document.querySelector(".product-description"));
        const combined = `${desc}\n${props}\n${wide}`;
        return {
          descChars: desc.length,
          propsChars: props.length,
          descHasMintageWord: /\bmintage\b/i.test(desc),
          propsHasMintageWord: /\bmintage\b/i.test(props),
          wideHasMintageWord: /\bmintage\b/i.test(wide),
        };
      });
      const mergedPlain = await page.evaluate(() => {
        const t = (el) => (el && (el.innerText || el.textContent) ? String(el.innerText || el.textContent).trim() : "");
        const narrow = t(document.querySelector(".product-description__text"));
        const wide = t(document.querySelector(".product-description"));
        return [wide, narrow].filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
      });
      const parsedFromText = extractPampMintagePhraseFromPlainText(mergedPlain);
      const specM = specs && specs.Mintage != null ? String(specs.Mintage).trim() : "";
      out.push({
        id: coinId,
        url,
        title: title || null,
        specsMintageRow: specM || null,
        parsedPhraseFromDomMerge: parsedFromText,
        ...dom,
      });
      process.stderr.write(`\rok ${coinId}   `);
    }
  } finally {
    await browser.close();
  }
  console.log(JSON.stringify(out, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
