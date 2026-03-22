/**
 * Тестовый парсинг ОДНОЙ страницы товара The Royal Mint (Playwright).
 * Формат JSON близок к Perth: { coin, raw, saved }.
 *
 * Запуск (из корня omonete-app):
 *   node scripts/fetch-royal-mint-coin-test.js
 *   node scripts/fetch-royal-mint-coin-test.js "https://www.royalmint.com/..."
 *   node scripts/fetch-royal-mint-coin-test.js --no-images   — только JSON, без скачивания webp
 *   node scripts/fetch-royal-mint-coin-test.js --allow-graded-slab — не пропускать, если на PDP в тексте есть NGC/PCGS graded
 *   node scripts/fetch-royal-mint-coin-test.js --allow-coin-box     — не пропускать «Coin Box» в названии/описании PDP
 *
 * По умолчанию URL — первая монета на листинге gold bullion (Lion and Eagle 2026 1oz).
 * Ссылки /shop/... переписываются на invest (gold или silver по эвристике URL).
 * Результат: data/royal-mint-<slug>.json; картинки — только БЕЗ флага --no-images → public/image/coins/foreign/*.webp
 *
 * Посмотреть монету на localhost (без БД):
 *   npm run royal-mint:local-catalog
 *   npm run dev
 *   открыть http://localhost:3000/coins/991001/
 * Если slug другой: npx tsx scripts/royal-mint-to-public-catalog.ts data/royal-mint-<slug>.json
 *
 * В БД: npm run royal-mint:import → npm run data:export — как у Perth (см. import-royal-mint-to-db.js).
 * Без БД для быстрого просмотра: npm run royal-mint:local-catalog → /coins/991001/
 */
const fs = require("fs");
const path = require("path");

const FOREIGN_DIR = path.join(__dirname, "..", "public", "image", "coins", "foreign");
const DATA_DIR = path.join(__dirname, "..", "data");
const ORIGIN = "https://www.royalmint.com";
const {
  rewriteShopPdpToInvestBullion,
  textLooksLikeGradedSlab,
  textLooksLikeCoinBox,
  getRoyalMintChromiumLaunchOptions,
  getRoyalMintBrowserContextOptions,
  applyRoyalMintPageHardening,
} = require("./royal-mint-listing-collect.js");

/**
 * Первая монета на листинге gold bullion (Lion and Eagle 2026 1oz).
 * Важно: ссылка с карточки часто /shop/... — в headless даёт 404; для парсинга используем invest PDP (тот же slug).
 */
const DEFAULT_URL =
  "https://www.royalmint.com/invest/bullion/bullion-coins/gold-coins/the-lion-and-the-eagle-2026-1oz-gold-bullion-coin/?listId=Gold_Coins&listName=Gold%20Coins";

function slugFromUrl(pageUrl) {
  const pathname = String(pageUrl).replace(/^https?:\/\/[^/]+/, "").replace(/\?.*$/, "").replace(/\/$/, "");
  const segments = pathname.split("/").filter(Boolean);
  const last = segments[segments.length - 1] || "royal-mint-coin";
  return last
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "") || "royal-mint-coin";
}

function normalizeUrl(u) {
  return String(u).trim().replace(/\/$/, "").split("?")[0] || u;
}

/** Классификация по имени файла Royal Mint (обратить внимание на порядок: сначала blister, edge отбрасываем). */
function classifyRoyalMintImage(url) {
  const lower = String(url).toLowerCase().split("?")[0];
  if (/logo|icon|feefo|payment|badge|ukas|placeholder|1x1|spacer|\.svg(\?|$)/i.test(lower)) return null;
  if (!/\.(jpg|jpeg|png|webp)(\?|$)/i.test(lower)) return null;
  if (/160x160|100x100|\/banners\//i.test(lower)) return null;
  if (/reverse-edge|on-edge|edge\.jpg/i.test(lower)) return null;
  if (/reverse.*blister|reverse-blister/i.test(lower)) return "blister_reverse";
  if (/obverse.*blister|obverse-blister/i.test(lower)) return "blister_obverse";
  if (/reverse.*capsule|capsule.*reverse/i.test(lower)) return "blister_reverse";
  if (/obverse.*capsule|capsule.*obverse/i.test(lower)) return "blister_obverse";
  if (/obverse.*latent|obverse-latent/i.test(lower)) return "obverse";
  if ((/\breverse\b|coin-reverse|-reverse\./i.test(lower) || /-reverse\.jpg/i.test(lower)) && !/obverse/i.test(lower)) return "reverse";
  if (/\bobverse\b|coin-obverse|-obverse\./i.test(lower) || /-obverse\.jpg/i.test(lower)) return "obverse";
  if (/box|case|shipper|outer-pack|presentation/i.test(lower)) return "certificate";
  if (/blister|secure-pack|in-pack/i.test(lower)) return "box";
  return null;
}

/**
 * Оставляем только картинки «этого» SKU: префикс файла вида ukb26svc--- из invest/.../products/.
 * Иначе на странице сотни баннеров с чужими reverse/obverse.
 */
function filterUrlsByPrimarySku(urls) {
  const candidates = urls.filter((u) => {
    const p = String(u).toLowerCase();
    return (
      /\/invest\/launches\//.test(p) &&
      /\/(?:products|product-images)\//.test(p) &&
      !/160x160|100x100|\/banners\//i.test(p) &&
      /\.(jpg|jpeg|webp)(\?|$)/i.test(p)
    );
  });
  const skuCounts = new Map();
  for (const u of candidates) {
    const file = u.split("/").pop().split("?")[0];
    const m = file.match(/^([a-z]{2,}\d{2}[a-z0-9]*)---/i);
    if (m) {
      const sku = m[1].toLowerCase();
      skuCounts.set(sku, (skuCounts.get(sku) || 0) + 1);
    }
  }
  let bestSku = null;
  let bestN = 0;
  for (const [sku, n] of skuCounts) {
    if (n > bestN) {
      bestN = n;
      bestSku = sku;
    }
  }
  if (!bestSku) return urls;
  const prefix = `${bestSku}---`;
  const filtered = urls.filter((u) => u.toLowerCase().includes(prefix));
  return filtered.length > 0 ? filtered : urls;
}

function pickBestByType(urls) {
  const by = {
    obverse: [],
    reverse: [],
    blister_obverse: [],
    blister_reverse: [],
    box: [],
    certificate: [],
  };
  for (const u of urls) {
    const t = classifyRoyalMintImage(u);
    if (t && by[t]) by[t].push(u);
  }
  const take = (arr) => (arr.length ? arr.sort((a, b) => b.length - a.length)[0] : null);
  return {
    obverse: take(by.obverse),
    reverse: take(by.reverse),
    blister_obverse: take(by.blister_obverse),
    blister_reverse: take(by.blister_reverse),
    box: take(by.box),
    certificate: take(by.certificate),
  };
}

function troyOzToG(ozStr) {
  if (ozStr == null) return null;
  const m = String(ozStr).replace(/,/g, ".").match(/([\d.]+)\s*troy\s*oz/i);
  if (!m) return null;
  const oz = parseFloat(m[1]);
  if (Number.isNaN(oz)) return null;
  const g = oz * 31.1034768;
  return Math.round(g * 1000) / 1000;
}

function parseDiameter(specs) {
  const v = specs.Diameter || specs["Maximum Diameter (mm)"] || "";
  const m = String(v).match(/([\d.]+)\s*mm/i);
  return m ? parseFloat(m[1]) : null;
}

function metalRu(metalEn) {
  const s = String(metalEn || "").toLowerCase();
  if (/gold|золот/i.test(s)) return "Золото";
  if (/silver|серебр/i.test(s)) return "Серебро";
  if (/platinum|платин/i.test(s)) return "Платина";
  if (/palladium|паллад/i.test(s)) return "Палладий";
  return metalEn || null;
}

async function extractPage(page) {
  return page.evaluate((origin) => {
    function absUrl(u) {
      if (!u) return "";
      const s = String(u).trim().split(/\s+/)[0];
      if (s.startsWith("http")) return s.split("?")[0];
      if (s.startsWith("//")) return ("https:" + s).split("?")[0];
      if (s.startsWith("/")) return (origin.replace(/\/$/, "") + s).split("?")[0];
      return (origin.replace(/\/$/, "") + "/" + s).split("?")[0];
    }

    const title =
      document.querySelector("h1.product-name, h1[itemprop=name], main h1, h1")?.textContent?.trim() ||
      document.title?.split("|")[0]?.trim() ||
      "";

    const specs = {};

    function mergeTableRowsIntoSpecs(table) {
      const bodies = table.tBodies && table.tBodies.length ? [...table.tBodies] : null;
      const rows = bodies
        ? bodies.flatMap((tb) => [...tb.querySelectorAll("tr")])
        : [...table.querySelectorAll("tr")].filter((tr) => !tr.closest("thead"));
      rows.forEach((tr) => {
        const cells = [...tr.querySelectorAll("th, td")].map((c) => c.textContent.replace(/\s+/g, " ").trim());
        if (cells.length < 2 || !cells[0]) return;
        const key = cells[0];
        if (/^(specification|value)$/i.test(key)) return;
        specs[key] = cells.slice(1).join(" ").trim();
      });
    }

    /** Как в инспекторе: div.mod-section.specification — таблицы .table внутри (th/td по строкам tbody). */
    const specSection = document.querySelector("div.mod-section.specification");
    let specificationBlockFound = false;
    if (specSection) {
      specificationBlockFound = true;
      specSection.querySelectorAll("table").forEach(mergeTableRowsIntoSpecs);
    }
    if (Object.keys(specs).length === 0) {
      document.querySelectorAll("table").forEach(mergeTableRowsIntoSpecs);
    }

    const descriptionChunks = [];
    const ogDesc = document.querySelector('meta[property="og:description"]')?.getAttribute("content")?.trim();
    if (ogDesc) descriptionChunks.push(ogDesc);
    const descSelectors = [
      '[itemprop="description"]',
      ".product-description",
      ".product-details__description",
      ".mod-text-block",
      ".rich-text",
      ".product-long-description",
    ];
    for (const sel of descSelectors) {
      const el = document.querySelector(sel);
      if (el && el.innerText && el.innerText.trim().length > 15) {
        descriptionChunks.push(el.innerText.replace(/\s+/g, " ").trim());
      }
    }
    const mainEl = document.querySelector("main");
    if (mainEl && mainEl.innerText) {
      descriptionChunks.push(mainEl.innerText.replace(/\s+/g, " ").trim().slice(0, 14000));
    }

    let price = "";
    const priceEl =
      document.querySelector("[itemprop=price]") ||
      document.querySelector(".price, .product-price, [data-price]");
    if (priceEl) {
      price = priceEl.getAttribute("content") || priceEl.textContent || "";
      price = String(price).replace(/\s+/g, " ").trim();
    }

    const imgSet = new Set();
    const pushImg = (u) => {
      const a = absUrl(u);
      if (a && /globalassets|royalmint\.com/i.test(a) && !/data:/i.test(a)) imgSet.add(a);
    };

    const og = document.querySelector('meta[property="og:image"]')?.getAttribute("content");
    if (og) pushImg(og);

    document.querySelectorAll('img[src], img[data-src], picture source[srcset]').forEach((el) => {
      let s = el.getAttribute("src") || el.getAttribute("data-src") || "";
      const srcset = el.getAttribute("srcset");
      if (srcset) {
        const first = srcset.split(",")[0].trim().split(/\s+/)[0];
        if (first) s = first;
      }
      if (s) pushImg(s);
    });

    return {
      title,
      specs,
      specificationBlockFound,
      price,
      imageUrls: [...imgSet],
      pdpPlainText: descriptionChunks.join("\n"),
    };
  }, ORIGIN);
}

async function downloadWebp(imgUrl, outPath) {
  const sharp = require("sharp");
  const res = await fetch(imgUrl, {
    headers: { "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36" },
    redirect: "follow",
  });
  if (!res.ok) throw new Error(String(res.status));
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length < 500) throw new Error("too small");
  const MAX_SIDE = 1200;
  await sharp(buf)
    .resize(MAX_SIDE, MAX_SIDE, { fit: "inside", withoutEnlargement: true })
    .webp({ quality: 82, effort: 6, smartSubsample: true })
    .toFile(outPath);
}

async function main() {
  const noImages = process.argv.includes("--no-images");
  const allowGradedSlab = process.argv.includes("--allow-graded-slab");
  const allowCoinBox = process.argv.includes("--allow-coin-box");
  const urlArg = process.argv.find((a) => a.startsWith("http"));
  const url = urlArg || DEFAULT_URL;
  const preferSilver = /\bsilver\b|ss360query=silver/i.test(url);
  const fetchUrl = rewriteShopPdpToInvestBullion(url, { preferSilver });
  const fileSlug = slugFromUrl(fetchUrl);

  const { chromium } = require("playwright");
  const browser = await chromium.launch(getRoyalMintChromiumLaunchOptions());
  const context = await browser.newContext(getRoyalMintBrowserContextOptions());
  const page = await context.newPage();
  await applyRoyalMintPageHardening(page);

  let scraped;
  try {
    await page.goto(fetchUrl, { waitUntil: "domcontentloaded", timeout: 120000 });
    await new Promise((r) => setTimeout(r, 2000));
    scraped = await extractPage(page);
    if (!scraped.specificationBlockFound) {
      console.warn(
        "Внимание: на странице не найден блок div.mod-section.specification — спеки взяты из остальных table (если есть)."
      );
    } else {
      console.log("Блок характеристик: div.mod-section.specification — найден, полей в specs:", Object.keys(scraped.specs || {}).length);
    }
  } finally {
    await browser.close();
  }

  const specsText = Object.values(scraped.specs || {})
    .map((v) => String(v))
    .join(" ");
  const pdpHaystack = [scraped.title, scraped.pdpPlainText, specsText].filter(Boolean).join("\n");
  if (!allowGradedSlab && textLooksLikeGradedSlab(pdpHaystack)) {
    const jsonPath = path.join(DATA_DIR, `royal-mint-${fileSlug}-skipped-graded-slab.json`);
    fs.mkdirSync(DATA_DIR, { recursive: true });
    const payload = {
      skipped: true,
      reason: "graded_slab_in_title_or_description",
      requestedUrl: url,
      pdpUrl: fetchUrl,
      title: scraped.title,
      pdpPlainTextPreview: (scraped.pdpPlainText || "").slice(0, 2000),
    };
    fs.writeFileSync(jsonPath, JSON.stringify(payload, null, 2), "utf8");
    console.warn("Пропуск: на странице товара в названии/описании/таблице спецификаций найден грейдинг NGC/PCGS.");
    console.warn("Файл:", jsonPath);
    console.warn("Чтобы всё равно парсить: добавьте флаг --allow-graded-slab");
    process.exit(0);
  }

  if (!allowCoinBox && textLooksLikeCoinBox(pdpHaystack)) {
    const jsonPath = path.join(DATA_DIR, `royal-mint-${fileSlug}-skipped-coin-box.json`);
    fs.mkdirSync(DATA_DIR, { recursive: true });
    const payload = {
      skipped: true,
      reason: "coin_box_in_title_or_description",
      requestedUrl: url,
      pdpUrl: fetchUrl,
      title: scraped.title,
      pdpPlainTextPreview: (scraped.pdpPlainText || "").slice(0, 2000),
    };
    fs.writeFileSync(jsonPath, JSON.stringify(payload, null, 2), "utf8");
    console.warn('Пропуск: на странице товара в названии/описании/спеках есть «Coin Box» (коробка на сотни монет).');
    console.warn("Файл:", jsonPath);
    console.warn("Чтобы всё равно парсить: добавьте флаг --allow-coin-box");
    process.exit(0);
  }

  const specs = scraped.specs || {};
  const yearStr = specs.Year || "";
  const yearMatch = String(yearStr).match(/\b(20\d{2}|19\d{2})\b/);
  const releaseDate = yearMatch ? `${yearMatch[1]}-01-01` : null;

  const weightG = troyOzToG(specs["Pure Metal Content"] || specs["Silver Content (Troy oz)"] || specs["Gold Content (Troy oz)"]);
  const diameterMm = parseDiameter(specs);

  const coin = {
    title: scraped.title || null,
    title_ru: null,
    country: "Великобритания",
    series: null,
    face_value: specs.Denomination ? String(specs.Denomination).trim() : null,
    release_date: releaseDate,
    mint: "The Royal Mint",
    mint_short: "Royal Mint",
    metal: metalRu(specs["Pure Metal Type"] || specs.Alloy),
    metal_fineness: specs.Fineness ? String(specs.Fineness).trim() : null,
    mintage: null,
    mintage_display: null,
    weight_g: weightG,
    weight_oz: null,
    diameter_mm: diameterMm,
    thickness_mm: null,
    length_mm: null,
    width_mm: null,
    quality: specs.Quality ? String(specs.Quality).trim() : null,
    catalog_number: `GB-ROYAL-${fileSlug.toUpperCase().replace(/[^A-Z0-9-]/g, "-")}`.slice(0, 80),
    catalog_suffix: fileSlug,
    price_display: scraped.price || null,
    source_url: normalizeUrl(fetchUrl),
    image_obverse: null,
    image_reverse: null,
    image_blister_reverse: null,
    image_blister_obverse: null,
    image_box: null,
    image_certificate: null,
  };

  const productUrls = filterUrlsByPrimarySku(scraped.imageUrls || []);
  const byType = pickBestByType(productUrls);
  const raw = {
    title: scraped.title,
    specs,
    specificationBlockFound: scraped.specificationBlockFound === true,
    imageUrls: scraped.imageUrls,
    imageUrlsProduct: productUrls,
    classified: byType,
    price: scraped.price,
    requestedUrl: url,
    pdpUrl: fetchUrl,
    pdpPlainTextPreview: (scraped.pdpPlainText || "").slice(0, 4000),
  };

  const saved = {
    obverse: null,
    reverse: null,
    blister_obverse: null,
    blister_reverse: null,
    box: null,
    certificate: null,
  };

  if (!noImages) {
    fs.mkdirSync(FOREIGN_DIR, { recursive: true });
    const jobs = [
      { key: "obverse", url: byType.obverse, file: `${fileSlug}-obv.webp`, coinKey: "image_obverse" },
      { key: "reverse", url: byType.reverse, file: `${fileSlug}-rev.webp`, coinKey: "image_reverse" },
      { key: "blister_obverse", url: byType.blister_obverse, file: `${fileSlug}-blister-obv.webp`, coinKey: "image_blister_obverse" },
      { key: "blister_reverse", url: byType.blister_reverse, file: `${fileSlug}-blister-rev.webp`, coinKey: "image_blister_reverse" },
      { key: "box", url: byType.box, file: `${fileSlug}-box.webp`, coinKey: "image_box" },
      { key: "certificate", url: byType.certificate, file: `${fileSlug}-cert.webp`, coinKey: "image_certificate" },
    ];

    for (const j of jobs) {
      if (!j.url) continue;
      const outAbs = path.join(FOREIGN_DIR, j.file);
      try {
        await downloadWebp(j.url, outAbs);
        const rel = "/image/coins/foreign/" + j.file;
        saved[j.key] = rel;
        coin[j.coinKey] = rel;
        console.log("  ✓", j.file);
      } catch (e) {
        console.warn("  ✗", j.file, j.url.slice(0, 80), e.message);
      }
    }
  }

  const jsonPath = path.join(DATA_DIR, `royal-mint-${fileSlug}.json`);
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(jsonPath, JSON.stringify({ coin, raw, saved }, null, 2), "utf8");

  console.log("\nГотово:", jsonPath);
  if (fetchUrl !== url) console.log("Исходная ссылка (listing):", url);
  console.log("Загрузка PDP:", fetchUrl);
  console.log("Классификация картинок:", JSON.stringify(byType, null, 2));

  console.log("\n────────── Как увидеть монету на сайте (localhost) ──────────");
  console.log("Парсинг только сохранил JSON в data/ — страница /coins/... читает public/data/coins/.");
  console.log("1) npm run royal-mint:local-catalog");
  if (fileSlug !== "the-lion-and-the-eagle-2026-1oz-gold-bullion-coin") {
    console.log("   (для этого slug точнее: npx tsx scripts/royal-mint-to-public-catalog.ts \"" + jsonPath + "\")");
  }
  console.log("2) npm run dev");
  console.log("3) http://localhost:3000/coins/991001/");
  if (noImages) {
    console.log("Был --no-images: превью возьмёт картинки с CDN Royal Mint из JSON; локальных webp нет.");
  } else {
    console.log("Картинки (если скачались): public/image/coins/foreign/ — пути уже в JSON монеты.");
  }
  console.log("В БД: npm run royal-mint:import → npm run data:export (или data:export:incremental).");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
