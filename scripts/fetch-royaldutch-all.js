/**
 * Массовый парсинг Royal Dutch Mint из scripts/royaldutch-mint-urls.txt.
 */
const fs = require("fs");
const path = require("path");
const { fetchOneWithPage, normalizeUrl, slugFromUrl } = require("./fetch-royaldutch-product.js");

const ROOT = path.join(__dirname, "..");
const DATA_DIR = path.join(ROOT, "data");
const URLS_TXT = path.join(__dirname, "royaldutch-mint-urls.txt");

function outPathForUrl(url) {
  return path.join(DATA_DIR, `royaldutch-mint-${slugFromUrl(url)}.json`);
}

async function main() {
  const onlyMissing = process.argv.includes("--only-missing");
  if (!fs.existsSync(URLS_TXT)) {
    console.error("Нет файла URL:", URLS_TXT, "Сначала: npm run royaldutch:listing");
    process.exit(1);
  }
  const list = fs
    .readFileSync(URLS_TXT, "utf8")
    .split(/\r?\n/)
    .map((x) => x.trim())
    .filter(Boolean)
    .map((u) => normalizeUrl(u))
    .filter(Boolean);
  if (!list.length) {
    console.log("Список URL пуст.");
    return;
  }

  const work = onlyMissing ? list.filter((u) => !fs.existsSync(outPathForUrl(u))) : list;
  console.log(`Всего URL: ${list.length}. К обработке: ${work.length}.`);
  if (!work.length) return;

  const { chromium } = require("playwright-extra");
  const StealthPlugin = require("puppeteer-extra-plugin-stealth");
  chromium.use(StealthPlugin());
  const browser = await chromium.launch({ headless: process.env.HEADLESS !== "0", args: ["--no-sandbox"] });
  const context = await browser.newContext({
    locale: "en-GB",
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    viewport: { width: 1400, height: 900 },
  });
  const page = await context.newPage();

  let ok = 0;
  let fail = 0;
  for (let i = 0; i < work.length; i++) {
    const u = work[i];
    process.stdout.write(`\r[${i + 1}/${work.length}] ${slugFromUrl(u)}   `);
    try {
      await fetchOneWithPage(page, u);
      ok++;
    } catch (e) {
      fail++;
      console.error(`\nFAIL ${u}:`, e && e.message ? e.message : e);
    }
  }
  await browser.close();
  console.log(`\nГотово. OK=${ok}, FAIL=${fail}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

