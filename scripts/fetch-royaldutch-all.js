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

function argvFromFile() {
  const a = process.argv.find((x) => x.startsWith("--from-file="));
  if (!a) return null;
  const p = a.slice("--from-file=".length).trim();
  return path.isAbsolute(p) ? p : path.join(ROOT, p);
}

async function main() {
  const onlyMissing = process.argv.includes("--only-missing");
  const fromFile = argvFromFile();
  const urlFile = fromFile || URLS_TXT;
  if (!fs.existsSync(urlFile)) {
    console.error("Нет файла URL:", urlFile, fromFile ? "" : "Сначала: npm run royaldutch:listing");
    process.exit(1);
  }
  const list = fs
    .readFileSync(urlFile, "utf8")
    .split(/\r?\n/)
    .map((x) => x.trim())
    .filter(Boolean)
    .map((u) => normalizeUrl(u))
    .filter(Boolean);
  if (!list.length) {
    console.log("Список URL пуст.");
    return;
  }

  const work = onlyMissing && !fromFile ? list.filter((u) => !fs.existsSync(outPathForUrl(u))) : list;
  console.log(`Источник URL: ${urlFile}. Всего: ${list.length}. К обработке: ${work.length}.`);
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

