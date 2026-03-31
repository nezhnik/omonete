/**
 * Массовый обход Scottsdale Mint: читает data/scottsdale-mint-listing-urls.txt,
 * парсит каждую карточку и пишет data/scottsdale-mint-*.json.
 */
const fs = require("fs");
const path = require("path");
const { fetchOneWithPage } = require("./fetch-scottsdale-product.js");

const ROOT = path.join(__dirname, "..");
const URLS_FILE = path.join(ROOT, "data", "scottsdale-mint-listing-urls.txt");

function readUrls() {
  if (!fs.existsSync(URLS_FILE)) {
    throw new Error("Нет списка URL. Сначала запустите: node scripts/fetch-scottsdale-listing.js");
  }
  return fs
    .readFileSync(URLS_FILE, "utf8")
    .split("\n")
    .map((x) => x.trim())
    .filter(Boolean);
}

async function main() {
  const onlyMissing = process.argv.includes("--only-missing");
  const limitArg = process.argv.find((a) => a.startsWith("--limit="));
  const limit = limitArg ? Number(limitArg.split("=")[1]) : 0;

  const urls = readUrls();
  const list = limit > 0 ? urls.slice(0, limit) : urls;

  const { chromium } = require("playwright-extra");
  const StealthPlugin = require("puppeteer-extra-plugin-stealth");
  chromium.use(StealthPlugin());
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({
    locale: "en-US",
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  });

  let ok = 0;
  let fail = 0;
  let skip = 0;

  for (let i = 0; i < list.length; i++) {
    const u = list[i];
    const slug = (() => {
      try {
        return (
          new URL(u).pathname.split("/").filter(Boolean).pop() || "scottsdale-product"
        )
          .toLowerCase()
          .replace(/[^a-z0-9._-]+/g, "-")
          .replace(/-+/g, "-")
          .replace(/^-|-$/g, "");
      } catch {
        return "scottsdale-product";
      }
    })();
    const out = path.join(ROOT, "data", `scottsdale-mint-${slug}.json`);
    if (onlyMissing && fs.existsSync(out)) {
      skip++;
      continue;
    }

    process.stdout.write(`\r[${i + 1}/${list.length}] ${slug}   `);
    try {
      const r = await fetchOneWithPage(page, u);
      if (r && r.skippedRandom) skip++;
      else ok++;
    } catch (e) {
      fail++;
      const errFile = path.join(ROOT, "data", "scottsdale-mint-fetch-errors.log");
      const block = [
        `--- ${new Date().toISOString()} ---`,
        `URL: ${u}`,
        `Error: ${String(e && e.message ? e.message : e)}`,
        "",
      ].join("\n");
      fs.appendFileSync(errFile, block, "utf8");
    }
  }
  await browser.close();

  console.log("\nГотово.");
  console.log("  ok:", ok);
  console.log("  fail:", fail);
  console.log("  skipped:", skip);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

