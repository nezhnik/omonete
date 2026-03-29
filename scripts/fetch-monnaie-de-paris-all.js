/**
 * Массовый парсинг Monnaie de Paris: data/monnaie-de-paris-listing-products.json (после mdp:listing).
 *
 *   npm run mdp:fetch:all
 *   npm run mdp:fetch:missing   — только без data/monnaie-de-paris-<slug>.json
 *   npm run mdp:import          — БД + скачивание webp в public/image/coins/foreign/
 *   npm run data:export:incremental — выгрузка на сайт (public/data/coins*)
 *
 * Прогресс (не теряется при обрыве):
 *   data/monnaie-de-paris-fetch-progress.ndjson  — одна строка JSON на карточку (ok/fail), порядок = порядок в листинге
 *   data/monnaie-de-paris-fetch-checkpoint.json  — последний индекс, счётчики, время (удобно смотреть глазами)
 *
 * Навигация: scripts/mdp-nav-options.js (мягче networkidle; env MDP_GOTO_* , MDP_SEL_*).
 * Скорость: куки — только на первой PDP (как Mennica); пауза между карточками MDP_DELAY_MS (по умолчанию 0).
 */
const fs = require("fs");
const path = require("path");
const {
  parseMonnaieDeParisProduct,
  normalizeUrl,
  slugFromUrl,
} = require("./fetch-monnaie-de-paris-product.js");
const { mdpPageGotoOptions, mdpSelectorTimeoutsMs } = require("./mdp-nav-options.js");

const DATA_DIR = path.join(__dirname, "..", "data");
const LISTING_JSON = path.join(DATA_DIR, "monnaie-de-paris-listing-products.json");
const FETCH_PROGRESS_NDJSON = path.join(DATA_DIR, "monnaie-de-paris-fetch-progress.ndjson");
const FETCH_CHECKPOINT_JSON = path.join(DATA_DIR, "monnaie-de-paris-fetch-checkpoint.json");

function appendProgressLine(obj) {
  fs.appendFileSync(FETCH_PROGRESS_NDJSON, JSON.stringify(obj) + "\n", "utf8");
}

function writeFetchCheckpoint(payload) {
  fs.writeFileSync(FETCH_CHECKPOINT_JSON, JSON.stringify(payload, null, 2), "utf8");
}

function outPathForUrl(url) {
  const slug = slugFromUrl(url);
  const safe = slug.replace(/[^a-z0-9_-]/gi, "_").slice(0, 120);
  return path.join(DATA_DIR, `monnaie-de-paris-${safe}.json`);
}

async function acceptCookies(page) {
  const sels = [
    "button#onetrust-accept-btn-handler",
    "button:has-text('Accept all')",
    "button:has-text('Tout accepter')",
  ];
  for (const sel of sels) {
    const el = page.locator(sel).first();
    if (await el.isVisible().catch(() => false)) {
      await el.click({ timeout: 2000 }).catch(() => {});
      await page.waitForTimeout(400);
      return;
    }
  }
}

async function main() {
  const onlyMissing = process.argv.includes("--only-missing");

  if (!fs.existsSync(LISTING_JSON)) {
    console.error("Нет", LISTING_JSON, "— сначала npm run mdp:listing");
    process.exit(1);
  }
  const items = JSON.parse(fs.readFileSync(LISTING_JSON, "utf8"));
  if (!Array.isArray(items) || !items.length) {
    console.error("Пустой листинг");
    process.exit(1);
  }

  const byUrl = new Map();
  for (const row of items) {
    const u = normalizeUrl(row.url);
    if (!u) continue;
    if (!byUrl.has(u)) byUrl.set(u, row);
  }
  let list = Array.from(byUrl.values());

  if (onlyMissing) {
    const before = list.length;
    list = list.filter((row) => {
      const fp = outPathForUrl(row.url);
      return !fs.existsSync(fp);
    });
    console.log("Режим --only-missing:", before, "в листинге → без файла:", list.length);
    if (!list.length) {
      console.log("Нечего парсить.");
      return;
    }
  }

  const { chromium } = require("playwright-extra");
  const StealthPlugin = require("puppeteer-extra-plugin-stealth");
  chromium.use(StealthPlugin());
  const browser = await chromium.launch({ headless: process.env.HEADLESS !== "0", args: ["--no-sandbox"] });
  const context = await browser.newContext({
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    locale: "en-GB",
    viewport: { width: 1366, height: 900 },
  });
  const page = await context.newPage();

  let ok = 0;
  let fail = 0;
  const runStartedAt = new Date().toISOString();
  try {
    for (let i = 0; i < list.length; i++) {
      const row = list[i];
      const u = normalizeUrl(row.url);
      const outFile = outPathForUrl(u);
      const listingMeta = { listing_url: row.listing_url || null, listing_label: row.listing_label || null };
      process.stdout.write(`[${i + 1}/${list.length}] ${u}\n`);
      let errMsg = null;
      try {
        const selMs = mdpSelectorTimeoutsMs();
        await page.goto(u, mdpPageGotoOptions());
        if (i === 0) await acceptCookies(page);
        await page.waitForTimeout(200);
        await page
          .waitForSelector("table.additional-attributes, .page-title-wrapper.product, [data-gallery-role=gallery-placeholder]", {
            timeout: selMs.main,
          })
          .catch(() => {});
        await page.waitForSelector(".product.media img.fotorama__img", { timeout: selMs.img }).catch(() => {});
        await page.waitForTimeout(250);
        const parsed = await parseMonnaieDeParisProduct(page, u, listingMeta);
        fs.writeFileSync(outFile, JSON.stringify(parsed, null, 2), "utf8");
        ok++;
        console.log("  OK →", path.basename(outFile));
        appendProgressLine({
          t: new Date().toISOString(),
          index: i + 1,
          total: list.length,
          url: u,
          ok: true,
          file: path.basename(outFile),
        });
      } catch (e) {
        fail++;
        errMsg = String(e && e.message ? e.message : e);
        console.error("  FAIL:", errMsg);
        appendProgressLine({
          t: new Date().toISOString(),
          index: i + 1,
          total: list.length,
          url: u,
          ok: false,
          error: errMsg,
        });
      }
      writeFetchCheckpoint({
        run_started_at: runStartedAt,
        updated_at: new Date().toISOString(),
        mode: onlyMissing ? "only-missing" : "all",
        last_index: i + 1,
        total: list.length,
        last_url: u,
        ok,
        fail,
        listing_json: path.basename(LISTING_JSON),
      });
      const pause = parseInt(process.env.MDP_DELAY_MS || "0", 10);
      if (pause > 0) await page.waitForTimeout(pause);
    }
  } finally {
    await browser.close();
  }

  console.log("—");
  console.log("Готово. OK:", ok, "ошибок:", fail);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
