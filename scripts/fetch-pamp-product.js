/**
 * Парсинг одной карточки PAMP collectibles.
 *
 * Правила ролей:
 * - front-certi -> blister_reverse
 * - back-certi  -> blister_obverse
 */
const fs = require("fs");
const path = require("path");
const { formatDenominationForFaceValue } = require("./format-coin-characteristics.js");

const DATA_DIR = path.join(__dirname, "..", "data");

function normalizeUrl(raw) {
  const u = new URL(raw);
  u.hash = "";
  return u.toString().replace(/\/$/, "");
}

/** Тираж и номинал из плоского текста описания (GQL или DOM). Заполняет только пустые поля. */
function mergeSpecsFromDescriptionPlain(specs, plain) {
  if (!plain || !specs) return;
  const descPlain = String(plain).replace(/\s+/g, " ").trim();
  if (!descPlain) return;
  if (!specs.Mintage) {
    const mintageCoins = descPlain.match(/\bmintage of (?:only\s+)?([\d,.\s]+)\s*coins?\b/i);
    const mintageBars = descPlain.match(/\blimited mintage of\s*([\d,.\s]+)\s*bars?\b/i);
    if (mintageCoins) specs.Mintage = mintageCoins[1].replace(/\s+/g, " ").trim();
    else if (mintageBars) specs.Mintage = mintageBars[1].replace(/\s+/g, " ").trim();
  }
  if (!specs.Denomination) {
    const solomon = /Solomon\s+Islands/i.test(descPlain);
    const tuvalu = /\bTuvalu\b/i.test(descPlain);
    const issuerCountry = solomon ? "Соломоновы Острова" : tuvalu ? "Тувалу" : null;
    if (issuerCountry) {
      let n = null;
      const usd = descPlain.match(/\$\s*(\d+(?:[.,]\d+)?)\b/);
      if (usd) n = Number(usd[1].replace(",", "."));
      if (!Number.isFinite(n) || n <= 0) {
        const fv = descPlain.match(/\bface\s+value(?:s)?\s+of\s+(\d+(?:[.,]\d+)?)\s*dollars?\b/i);
        if (fv) n = Number(fv[1].replace(",", "."));
      }
      if (!Number.isFinite(n) || n <= 0) {
        if (/\b(?:two)\s+dollars?\b/i.test(descPlain)) n = 2;
      }
      if (Number.isFinite(n) && n > 0) {
        const face = formatDenominationForFaceValue(n, issuerCountry);
        if (face) specs.Denomination = face;
      }
    }
  }
}

function slugFromUrl(url) {
  const u = new URL(url);
  const parts = u.pathname.split("/").filter(Boolean);
  return parts[parts.length - 1] || "pamp-product";
}

/** URL кадра Assay/CertiPAMP (в т.ч. *-certipamp.png без front/back в имени). */
function isCertiBlisterImageUrl(u) {
  const s = String(u || "").toLowerCase();
  return /certipamp|certi[-_]?(front|back)|back[-_]?certi|front[-_]?certi|obverse[-_]?certi|[-_/]certi\.|certi\.png/i.test(s);
}

/**
 * Достраивает blister_obverse / blister_reverse по списку картинок: у зодиаков и др. имена вида
 * *-certipamp.png не проходят через certi-front/back в цикле ниже.
 * Порядок как на сайте PAMP: первый свободный слот — blister_reverse, второй — blister_obverse
 * (совпадает с front-certipamp → reverse, back-certipamp → obverse).
 */
function fillMissingBlisterSlotsFromImageUrls(classified, orderedUrls) {
  if (!classified || !Array.isArray(orderedUrls)) return;
  for (const u of orderedUrls) {
    if (!u || !isCertiBlisterImageUrl(u)) continue;
    if (u === classified.blister_obverse || u === classified.blister_reverse) continue;
    if (!classified.blister_reverse) classified.blister_reverse = u;
    else if (!classified.blister_obverse) classified.blister_obverse = u;
    else break;
  }
}

function buildFromGqlProduct(product, sourceUrl) {
  const specs = {};
  if (product.material) specs.Metal = String(product.material).trim();
  if (product.weight != null) specs.Weight = `${String(product.weight).replace(".", ",")} g`;
  if (product.thickness) specs.Thickness = String(product.thickness).trim();
  if (product.sku) specs.SKU = String(product.sku).trim();
  if (product.width != null && product.height != null) specs["Size (mm)."] = `${product.width} x ${product.height}`;
  if (product.created && /^(\d{4})-/.test(String(product.created))) specs.Year = String(product.created).slice(0, 4);

  const rawDesc = String(product.description || "");
  const descPlain = rawDesc.replace(/<[^>]+>/gi, " ").replace(/\s+/g, " ").trim();
  mergeSpecsFromDescriptionPlain(specs, descPlain);

  const classified = {
    obverse: null,
    reverse: null,
    blister_obverse: null,
    blister_reverse: null,
    packaging: null,
    box: null,
    certificate: null,
  };
  const isCertiFront = (s) => /certi[-_ ]?front|front[-_ ]?certi/i.test(s);
  const isCertiBack = (s) => /certi[-_ ]?back|back[-_ ]?certi/i.test(s);
  const isCertiAny = (s) => /certi|certipamp/i.test(s);
  const isSleeve = (s) => /sleeve[-_ ]?(front|back)|(^|[_-])sleeve([_-]|$)/i.test(s);
  const isBoxLike = (s) => /outer[_-]?box|(^|[_\-\/])box([._\-\/]|$)|capsule.*box|box.*capsule/i.test(s);
  const imageUrls = [];
  for (const im of Array.isArray(product.images) ? product.images : []) {
    const front = im?.frontImage ? String(im.frontImage).trim() : null;
    const back = im?.backImage ? String(im.backImage).trim() : null;
    if (front) imageUrls.push(front);
    if (back) imageUrls.push(back);
    const frontLower = String(front || "").toLowerCase();
    const backLower = String(back || "").toLowerCase();
    if (front && isCertiFront(frontLower) && !classified.blister_reverse) classified.blister_reverse = front;
    if (back && (isCertiBack(backLower) || /obverse[-_]?certi/i.test(backLower)) && !classified.blister_obverse) classified.blister_obverse = back;
    if (front && isBoxLike(frontLower) && !classified.box) classified.box = front;
    if (back && isBoxLike(backLower) && !classified.box) classified.box = back;
    if (front && isSleeve(frontLower) && !classified.packaging) classified.packaging = front;
    if (back && isSleeve(backLower) && !classified.packaging) classified.packaging = back;
    if (front && !isCertiAny(frontLower) && !isBoxLike(frontLower) && !isSleeve(frontLower) && !classified.reverse) classified.reverse = front;
    if (back && !isCertiAny(backLower) && !isBoxLike(backLower) && !isSleeve(backLower) && !classified.obverse) classified.obverse = back;
  }
  fillMissingBlisterSlotsFromImageUrls(classified, imageUrls);
  if (!classified.packaging) classified.packaging = classified.blister_reverse || classified.blister_obverse || null;
  if (classified.box && /outer[_-]?box|opened/i.test(String(classified.box))) {
    classified.certificate = classified.box;
  }

  return {
    source_url: sourceUrl,
    title: String(product.title || "").trim() || null,
    specs,
    classified,
    imageUrls: Array.from(new Set(imageUrls)),
    parsedAt: new Date().toISOString(),
  };
}

async function parseViaDom(page, sourceUrl) {
  const data = await page.evaluate((sourceUrlInPage) => {
    const text = (el) => (el && el.textContent ? el.textContent.trim() : "");
    const titleRaw = text(document.querySelector("h1")) || text(document.querySelector("title")) || null;
    const title = titleRaw ? String(titleRaw).replace(/\s*\|\s*PAMP\s*$/i, "").trim() : null;
    const specs = {};
    const rawTxt = text(document.querySelector(".product-description__product-properties"));
    const lines = rawTxt.split("\n").map((x) => x.trim()).filter(Boolean);
    for (let i = 0; i + 1 < lines.length; i += 2) {
      const k = lines[i].replace(/:$/, "");
      if (k && lines[i + 1] && !specs[k]) specs[k] = lines[i + 1];
    }
    const narrow = text(document.querySelector(".product-description__text"));
    const wide = text(document.querySelector(".product-description"));
    const mergedDesc = [wide, narrow].filter(Boolean).join(" ");
    const descPlainForMerge = mergedDesc ? mergedDesc.replace(/\s+/g, " ").trim() : "";
    const imageUrls = Array.from(new Set(Array.from(document.querySelectorAll("img"))
      .map((img) => img.getAttribute("src") || img.getAttribute("data-src") || "")
      .filter((u) => /^https?:\/\//i.test(u))));
    return {
      source_url: sourceUrlInPage,
      title,
      specs,
      classified: { obverse: null, reverse: null, blister_obverse: null, blister_reverse: null, packaging: null, box: null, certificate: null },
      imageUrls,
      parsedAt: new Date().toISOString(),
      descPlainForMerge,
    };
  }, sourceUrl);
  if (data.descPlainForMerge) mergeSpecsFromDescriptionPlain(data.specs, data.descPlainForMerge);
  delete data.descPlainForMerge;
  return data;
}

async function parsePampProduct(page, sourceUrl, gqlProduct) {
  if (gqlProduct) {
    const parsed = buildFromGqlProduct(gqlProduct, sourceUrl);
    const domPlain = await page.evaluate(() => {
      const text = (el) => (el && (el.innerText || el.textContent) ? String(el.innerText || el.textContent) : "");
      const narrow = text(document.querySelector(".product-description__text"));
      const wide = text(document.querySelector(".product-description"));
      const merged = [wide, narrow].filter(Boolean).join(" ");
      return merged.replace(/\s+/g, " ").trim();
    });
    if (domPlain) mergeSpecsFromDescriptionPlain(parsed.specs, domPlain);
    return parsed;
  }
  return parseViaDom(page, sourceUrl);
}

async function main() {
  const rawUrl = process.argv.find((a) => /^https?:\/\//i.test(a));
  if (!rawUrl) {
    console.error("Передайте URL: node scripts/fetch-pamp-product.js \"https://www.pamp.com/product/collectible/...\"");
    process.exit(1);
  }
  const sourceUrl = normalizeUrl(rawUrl);
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

  const { chromium } = require("playwright-extra");
  const StealthPlugin = require("puppeteer-extra-plugin-stealth");
  chromium.use(StealthPlugin());
  const browser = await chromium.launch({ headless: process.env.HEADLESS !== "0", args: ["--no-sandbox"] });
  const context = await browser.newContext({
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    viewport: { width: 1366, height: 900 },
  });
  const page = await context.newPage();
  let gqlProduct = null;
  page.on("response", async (res) => {
    if (gqlProduct || !/\/graphql$/i.test(res.url())) return;
    try {
      const bodyRaw = res.request().postData() || "";
      if (!bodyRaw.includes("pageByUrl")) return;
      const json = await res.json();
      if (json?.data?.pageByUrl && typeof json.data.pageByUrl === "object") gqlProduct = json.data.pageByUrl;
    } catch {
      // ignore
    }
  });
  let parsed;
  try {
    await page.goto(sourceUrl, { waitUntil: "networkidle", timeout: 90000 });
    await page.waitForTimeout(2500);
    parsed = await parsePampProduct(page, sourceUrl, gqlProduct);
  } finally {
    await browser.close();
  }

  const slug = slugFromUrl(sourceUrl);
  const outFile = path.join(DATA_DIR, `pamp-collectible-${slug}.json`);
  fs.writeFileSync(outFile, JSON.stringify(parsed, null, 2), "utf8");
  console.log("Сохранено:", outFile);
  console.log("Title:", parsed.title || "—");
  console.log("Specs keys:", Object.keys(parsed.specs || {}).length);
  console.log("Images:", (parsed.imageUrls || []).length);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

