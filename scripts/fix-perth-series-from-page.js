/**
 * Быстрое исправление series во всех perth-mint-*.json.
 * Загружает страницу, извлекает breadcrumb из pageMetadataObject, обновляет JSON.
 * Без картинок — только metadata. ~5–7 сек на монету vs ~30+ при полном fetch.
 *
 *   node scripts/fix-perth-series-from-page.js              — по умолчанию: все JSON (по source_url)
 *   node scripts/fix-perth-series-from-page.js --from-urls   — все из perth-mint-urls.txt
 *   node scripts/fix-perth-series-from-page.js --from-missing — только из perth-mint-missing-in-db.txt
 *   node scripts/fix-perth-series-from-page.js --force — перезаписывать series даже когда совпадает (проверка)
 */
const fs = require("fs");
const path = require("path");

const DATA_DIR = path.join(__dirname, "..", "data");
const URL_LIST_FILE = path.join(__dirname, "perth-mint-urls.txt");
const MISSING_FILE = path.join(__dirname, "perth-mint-missing-in-db.txt");

function seriesFromBreadcrumb(bc) {
  if (!Array.isArray(bc) || bc.length < 3) return null;
  const last = bc[bc.length - 1];
  // Home > Collector coins > Sovereigns > ...  или  Coin Sets > ...
  if (bc.length === 4 && (bc[2] === "Sovereigns" || bc[2] === "Coin Sets")) {
    return bc[2] === "Sovereigns" ? "Gold Sovereign" : "Coin Sets";
  }
  // Home > Collector coins > Coins > "Series - Title"  → серия до " - "
  if (bc.length === 4 && last.includes(" - ")) {
    return last.split(" - ")[0].trim();
  }
  // Home > Collector coins > Coins > "Series 2023 ..."  → серия до года
  if (bc.length === 4 && bc[2] === "Coins" && /\b(20|19)\d{2}\b/.test(last)) {
    const m = last.match(/^(.+?)\s+(?:20|19)\d{2}/);
    return m ? m[1].trim() : null;
  }
  if (bc.length === 3 && /\b(20|19)\d{2}\b/.test(last)) {
    const m = last.match(/^(.+?)\s+(?:20|19)\d{2}/);
    return m ? m[1].trim() : null;
  }
  if (bc.length === 3 && !/^(Home|Collector coins|Coins)$/i.test(last)) {
    const m = last.match(/^(.+?)\s+(?:20|19)\d{2}/);
    return m ? m[1].trim() : last;
  }
  return null;
}

async function getSeriesFromPage(page, url) {
  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 20000 });
    await page.waitForSelector("#pageMetadataObject", { timeout: 4000 }).catch(() => {});
    await page.waitForTimeout(800);
    const meta = await page.evaluate(() => {
      const el = document.getElementById("pageMetadataObject");
      if (!el) return null;
      try {
        return JSON.parse(el.textContent);
      } catch (e) {
        return null;
      }
    });
    return meta?.breadcrumb ? seriesFromBreadcrumb(meta.breadcrumb) : null;
  } catch (e) {
    return null;
  }
}

async function main() {
  let urls = [];
  const fromUrls = process.argv.includes("--from-urls");
  const fromMissing = process.argv.includes("--from-missing");
  const fromJson = !fromUrls && !fromMissing;

  const fileByUrl = new Map();
  if (fromMissing && fs.existsSync(MISSING_FILE)) {
    urls = fs.readFileSync(MISSING_FILE, "utf8")
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter((s) => s && s.startsWith("http"));
  } else if (fromJson) {
    const files = fs.readdirSync(DATA_DIR)
      .filter((f) => f.startsWith("perth-mint-") && f.endsWith(".json"));
    for (const f of files) {
      try {
        const raw = JSON.parse(fs.readFileSync(path.join(DATA_DIR, f), "utf8"));
        const url = raw?.coin?.source_url;
        if (url && url.includes("perthmint.com")) {
          const norm = url.trim().replace(/\/+$/, "");
          fileByUrl.set(norm, f);
          urls.push(url);
        }
      } catch (e) {}
    }
  } else if (fromUrls && fs.existsSync(URL_LIST_FILE)) {
    urls = fs.readFileSync(URL_LIST_FILE, "utf8")
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter((s) => s && s.startsWith("http"));
  } else if (fromMissing) {
    console.error("Нет perth-mint-missing-in-db.txt. Сначала: node scripts/check-perth-urls-vs-db.js --write");
    process.exit(1);
  } else {
    console.error("Нет perth-mint-urls.txt. Используйте --from-json");
    process.exit(1);
  }

  const seen = new Set();
  urls = urls.filter((u) => {
    const n = u.replace(/\/$/, "");
    if (seen.has(n)) return false;
    seen.add(n);
    return true;
  });

  console.log("URL для проверки series:", urls.length);
  console.log("Источник:", fromMissing ? "perth-mint-missing-in-db.txt" : fromJson ? "JSON (source_url)" : "perth-mint-urls.txt\n");

  const concurrencyArg = process.argv.find((a) => a.startsWith("--concurrency="));
  let concurrency = concurrencyArg ? parseInt(concurrencyArg.split("=")[1], 10) || 1 : 1;
  if (concurrency < 1) concurrency = 1;
  if (concurrency > 8) concurrency = 8;
  if (concurrency > urls.length) concurrency = urls.length;

  let chromium;
  try {
    const playwrightExtra = require("playwright-extra");
    chromium = playwrightExtra.chromium;
    chromium.use(require("puppeteer-extra-plugin-stealth")());
  } catch (e) {
    console.error("Нужны: playwright-extra, puppeteer-extra-plugin-stealth");
    process.exit(1);
  }

  const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
  const pages = [];
  for (let i = 0; i < concurrency; i++) {
    const page = await browser.newPage();
    page.setDefaultTimeout(20000);
    pages.push(page);
  }

  let updated = 0;
  let noJson = 0;
  let unchanged = 0;

  let index = 0;

  async function worker(page) {
    while (true) {
      const i = index++;
      if (i >= urls.length) break;
      const url = urls[i];
      const series = await getSeriesFromPage(page, url);
      let jsonPath;
      if (fromJson && fileByUrl.size > 0) {
        const norm = url.trim().replace(/\/+$/, "");
        const f = fileByUrl.get(norm);
        jsonPath = f ? path.join(DATA_DIR, f) : null;
        if (!jsonPath) {
          const pathname = url.replace(/^https?:\/\/[^/]+/, "").replace(/\?.*$/, "").replace(/\/$/, "");
          const lastSeg = pathname.split("/").filter(Boolean).pop() || "";
          const slug = lastSeg.toLowerCase().replace(/[^a-z0-9-]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "") || "perth-coin";
          jsonPath = path.join(DATA_DIR, `perth-mint-${slug}.json`);
        }
      } else {
        const pathname = url.replace(/^https?:\/\/[^/]+/, "").replace(/\?.*$/, "").replace(/\/$/, "");
        const lastSeg = pathname.split("/").filter(Boolean).pop() || "";
        const slug = lastSeg.toLowerCase().replace(/[^a-z0-9-]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "") || "perth-coin";
        jsonPath = path.join(DATA_DIR, `perth-mint-${slug}.json`);
      }

      if (!fs.existsSync(jsonPath)) {
        noJson++;
        if ((i + 1) % 50 === 0) process.stdout.write(`  [${i + 1}/${urls.length}] …\r`);
        await new Promise((r) => setTimeout(r, 250));
        continue;
      }

      const raw = JSON.parse(fs.readFileSync(jsonPath, "utf8"));
      const prev = raw?.coin?.series;
      const forceOverwrite = process.argv.includes("--force");
      const needWrite = forceOverwrite || series !== prev;
      if (needWrite && raw.coin) {
        raw.coin.series = series;
        fs.writeFileSync(jsonPath, JSON.stringify(raw, null, 2), "utf8");
        updated++;
        if (series !== prev) {
          const name = path.basename(jsonPath, ".json").replace(/^perth-mint-/, "");
          console.log(`  ✓ ${name.slice(0, 50)}: "${prev || "null"}" → "${series || "null"}"`);
        }
      } else if (!needWrite) {
        unchanged++;
      }

      if ((i + 1) % 30 === 0) process.stdout.write(`  [${i + 1}/${urls.length}] обновлено ${updated}, без JSON ${noJson}\r`);
      await new Promise((r) => setTimeout(r, 250));
    }
  }

  await Promise.all(pages.map((p) => worker(p)));

  for (const page of pages) {
    await page.close();
  }
  await browser.close();

  console.log(`\nГотово. Обновлено: ${updated}, без изменений: ${unchanged}, нет JSON: ${noJson}`);
  if (updated > 0) {
    console.log("Дальше: node scripts/import-perth-mint-to-db.js --all-by-source-url");
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
