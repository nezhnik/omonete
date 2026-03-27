/**
 * Для всех data/pamp-collectible-*.json: если нет specs.Mintage, открывает страницу
 * и вытаскивает тираж из текста описания (.product-description + __text).
 *
 *   node scripts/pamp-backfill-mintage-from-description.js
 *   node scripts/pamp-backfill-mintage-from-description.js --force   перезаписать Mintage
 *
 * Дальше: npm run pamp:import (весь каталог или выборочно) && npm run data:export:incremental
 */
const fs = require("fs");
const path = require("path");

const DATA_DIR = path.join(__dirname, "..", "data");

function listPampCollectibleJsonFiles() {
  if (!fs.existsSync(DATA_DIR)) return [];
  return fs
    .readdirSync(DATA_DIR)
    .filter((name) => name.startsWith("pamp-collectible-") && name.endsWith(".json"))
    .map((name) => path.join(DATA_DIR, name));
}

function extractMintageFromPlain(plain) {
  if (!plain) return null;
  const descPlain = String(plain).replace(/\s+/g, " ").trim();
  if (!descPlain) return null;
  const mintageCoins = descPlain.match(/\bmintage of (?:only\s+)?([\d,.\s]+)\s*coins?\b/i);
  const mintageBars = descPlain.match(/\blimited mintage of\s*([\d,.\s]+)\s*bars?\b/i);
  if (mintageCoins) return mintageCoins[1].replace(/\s+/g, " ").trim();
  if (mintageBars) return mintageBars[1].replace(/\s+/g, " ").trim();
  return null;
}

async function main() {
  const force = process.argv.includes("--force");
  const files = listPampCollectibleJsonFiles().sort();
  if (!files.length) {
    console.error("Нет файлов pamp-collectible-*.json в", DATA_DIR);
    process.exit(1);
  }

  const { chromium } = require("playwright-extra");
  const StealthPlugin = require("puppeteer-extra-plugin-stealth");
  chromium.use(StealthPlugin());
  const browser = await chromium.launch({ headless: process.env.HEADLESS !== "0", args: ["--no-sandbox"] });
  const context = await browser.newContext({
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    viewport: { width: 1366, height: 900 },
  });
  const page = await context.newPage();

  let skipped = 0;
  let updated = 0;
  let unchanged = 0;
  let errors = 0;

  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    const rel = path.basename(file);
    let data;
    try {
      data = JSON.parse(fs.readFileSync(file, "utf8"));
    } catch (e) {
      console.error(`[${i + 1}/${files.length}] ${rel} — не читается JSON`, e.message);
      errors++;
      continue;
    }
    const url = data.source_url && String(data.source_url).trim();
    if (!url || !/^https?:\/\//i.test(url)) {
      console.warn(`[${i + 1}/${files.length}] ${rel} — нет source_url`);
      errors++;
      continue;
    }
    const specs = data.specs && typeof data.specs === "object" ? data.specs : {};
    if (specs.Mintage && String(specs.Mintage).trim() && !force) {
      skipped++;
      continue;
    }

    process.stdout.write(`[${i + 1}/${files.length}] ${rel} … `);
    let mintage = null;
    try {
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 90000 });
      await page.waitForTimeout(1500);
      const plain = await page.evaluate(() => {
        const text = (el) => (el && (el.innerText || el.textContent) ? String(el.innerText || el.textContent) : "");
        const wide = text(document.querySelector(".product-description"));
        const narrow = text(document.querySelector(".product-description__text"));
        return [wide, narrow].filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
      });
      mintage = extractMintageFromPlain(plain);
    } catch (e) {
      console.log("ошибка:", e.message);
      errors++;
      continue;
    }

    if (!mintage) {
      console.log("тираж в описании не найден");
      unchanged++;
      continue;
    }
    if (!data.specs) data.specs = {};
    const prev = data.specs.Mintage;
    data.specs.Mintage = mintage;
    try {
      fs.writeFileSync(file, JSON.stringify(data, null, 2), "utf8");
    } catch (e) {
      console.log("запись:", e.message);
      errors++;
      continue;
    }
    if (prev && force) console.log(`обновлено (было: ${prev}) → ${mintage}`);
    else console.log(`+ Mintage: ${mintage}`);
    updated++;
  }

  await browser.close();
  console.log("—");
  console.log("Обновлено файлов:", updated);
  console.log("Пропущено (уже был Mintage):", skipped);
  console.log("Без тиража в тексте:", unchanged);
  console.log("Ошибок:", errors);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
