/**
 * Для каждого URL из royal-mint-seed-urls.txt (или --file) открывает страницу и проверяет
 * наличие div.mod-section.specification и число строк таблиц спецификаций.
 *
 * Запуск (из корня omonete-app):
 *   npm run royal-mint:verify-specs
 *   node scripts/royal-mint-verify-specification-block.js --limit 20
 *   node scripts/royal-mint-verify-specification-block.js --file scripts/royal-mint-seed-urls.txt
 */
const path = require("path");
const fs = require("fs");
const { readSeedUrlsFromFile } = require("./royal-mint-seed-url-io.js");
const {
  rewriteShopPdpToInvestBullion,
  getRoyalMintChromiumLaunchOptions,
  getRoyalMintBrowserContextOptions,
  applyRoyalMintPageHardening,
} = require("./royal-mint-listing-collect.js");

const DEFAULT_SEED = path.join(__dirname, "royal-mint-seed-urls.txt");

async function checkPage(page, url) {
  const fetchUrl = rewriteShopPdpToInvestBullion(url, { preferSilver: /\bsilver\b/i.test(url) });
  await page.goto(fetchUrl, { waitUntil: "domcontentloaded", timeout: 120000 });
  await new Promise((r) => setTimeout(r, 1500));
  return page.evaluate(() => {
    const root = document.querySelector("div.mod-section.specification");
    if (!root) return { found: false, specRows: 0, fetchPath: "" };
    let rows = 0;
    root.querySelectorAll("table tbody tr").forEach((tr) => {
      const cells = tr.querySelectorAll("th, td");
      if (cells.length >= 2) rows += 1;
    });
    return { found: true, specRows: rows, fetchPath: location.pathname };
  });
}

async function main() {
  const limitIdx = process.argv.indexOf("--limit");
  const limit = limitIdx !== -1 && process.argv[limitIdx + 1] ? parseInt(process.argv[limitIdx + 1], 10) : 0;
  const fileIdx = process.argv.indexOf("--file");
  const seedPath =
    fileIdx !== -1 && process.argv[fileIdx + 1]
      ? path.isAbsolute(process.argv[fileIdx + 1])
        ? process.argv[fileIdx + 1]
        : path.join(process.cwd(), process.argv[fileIdx + 1])
      : DEFAULT_SEED;

  let urls = readSeedUrlsFromFile(seedPath);
  if (urls.length === 0) {
    console.error("Нет URL в файле:", seedPath);
    process.exit(1);
  }
  if (limit > 0) urls = urls.slice(0, limit);

  console.log("Файл:", seedPath);
  console.log("Проверка URL:", urls.length);

  const { chromium } = require("playwright");
  const browser = await chromium.launch(getRoyalMintChromiumLaunchOptions());
  const context = await browser.newContext(getRoyalMintBrowserContextOptions());
  const page = await context.newPage();
  await applyRoyalMintPageHardening(page);

  const report = [];
  try {
    for (let i = 0; i < urls.length; i++) {
      const u = urls[i];
      process.stdout.write(`[${i + 1}/${urls.length}] ${u.slice(0, 72)}… `);
      try {
        const r = await checkPage(page, u);
        const ok = r.found && r.specRows > 0;
        console.log(ok ? `OK (${r.specRows} полей)` : r.found ? "нет строк в table tbody" : "НЕТ блока specification");
        report.push({ url: u, ok, ...r });
      } catch (e) {
        console.log("ОШИБКА:", e.message);
        report.push({ url: u, ok: false, error: String(e.message) });
      }
    }
  } finally {
    await browser.close();
  }

  const bad = report.filter((r) => !r.ok);
  const outJson = path.join(__dirname, "..", "data", "royal-mint-specification-verify.json");
  fs.mkdirSync(path.dirname(outJson), { recursive: true });
  fs.writeFileSync(outJson, JSON.stringify({ checkedAt: new Date().toISOString(), total: report.length, failed: bad.length, report }, null, 2), "utf8");
  console.log("\nОтчёт:", outJson);
  console.log("Успешно:", report.length - bad.length, "| проблемы:", bad.length);
  if (bad.length) process.exitCode = 1;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
