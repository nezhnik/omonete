/**
 * Загружает страницу монеты Perth Mint, извлекает данные и картинки.
 * Сохраняет изображения в public/image/coins/foreign/, данные — в data/perth-mint-*.json.
 * Поддерживает любую страницу товара: SKU и год извлекаются из URL картинок на странице.
 * Типы картинок: аверс (obverse), реверс (reverse), коробка (box), сертификат (certificate) —
 * определяются по имени файла и записываются в image_obverse, image_reverse, image_box, image_certificate
 * (в БД и экспорте эти поля уже есть; галерея на сайте показывает все четыре).
 *
 * Запуск:
 *   node scripts/fetch-perth-mint-coin.js              — берёт ссылки из scripts/perth-mint-urls.txt, пропускает уже обработанные
 *   node scripts/fetch-perth-mint-coin.js <url>       — одна ссылка из аргумента
 *   node scripts/fetch-perth-mint-coin.js --refetch-lost --refresh — переспарсить «потерянные» URL из perth-mint-refetch-urls.txt (см. list-perth-mint-refetch-urls.js)
 *   node scripts/fetch-perth-mint-coin.js --refresh --no-image-cache — полный перезабор: все страницы и все изображения заново (без кэша картинок).
 * Имя JSON и картинок: по slug из URL (последний сегмент пути), чтобы 1 URL = 1 запись, без перезаписи разных монет.
 * Режим проверки: если уже есть JSON для этого URL, сравниваются характеристики и наличие картинок. Если ничего не изменилось — пропуск (быстро). Если изменились только часть данных — обновляются только они (докачиваются только недостающие изображения, перезаписываются только изменившиеся поля).
 * Прогресс сохраняется в data/perth-mint-fetch-progress.json: список completedUrls и coins (catalog_number, title, jsonPath).
 * При повторном запуске обработанные URL не дублируются.
 */
const fs = require("fs");
const path = require("path");
const { roundSpec, normalizeWeightG, deriveMetalAndWeightFromTitle, normalizeLegalTender, formatDenominationForFaceValue } = require("./format-coin-characteristics.js");

const DEFAULT_URL =
  "https://www.perthmint.com/shop/collector-coins/coins/deadly-and-dangerous-australias-giant-centipede-2026-1oz-silver-proof-coloured-coin/";

const FOREIGN_DIR = path.join(__dirname, "..", "public", "image", "coins", "foreign");
const DATA_DIR = path.join(__dirname, "..", "data");
const PUBLIC_DIR = path.join(__dirname, "..", "public");

const BASE_URL = "https://www.perthmint.com";

/** Поля монеты для сравнения (характеристики + название). */
const COIN_SPEC_FIELDS = ["title", "country", "face_value", "weight_g", "diameter_mm", "thickness_mm", "length_mm", "width_mm", "metal", "metal_fineness", "quality", "mintage", "release_date", "catalog_number", "catalog_suffix", "price_display", "series"];

/** Сравнение двух объектов монеты по характеристикам (вес нормализуем через normalizeWeightG). */
function compareCoinSpecs(existingCoin, newCoin) {
  for (const key of COIN_SPEC_FIELDS) {
    const a = existingCoin[key];
    const b = newCoin[key];
    if (key === "weight_g") {
      const na = normalizeWeightG(a);
      const nb = normalizeWeightG(b);
      if (na !== nb) return false;
      continue;
    }
    const sa = a == null ? "" : String(a).trim();
    const sb = b == null ? "" : String(b).trim();
    if (sa !== sb) return false;
  }
  return true;
}

/** Путь из JSON (/image/coins/foreign/xxx.webp) → абсолютный путь к файлу. */
function resolveImagePath(relPath) {
  if (!relPath || typeof relPath !== "string") return null;
  const p = relPath.replace(/^\/+/, "");
  return path.join(PUBLIC_DIR, p);
}

/** Какие типы картинок нужно докачать: на странице есть URL, но у нас нет файла или пути. */
function getMissingImageSuffixes(existingCoin, byType, fileSlug) {
  const suffixToCoinKey = [
    { suffix: "rev", key: "image_reverse" },
    { suffix: "obv", key: "image_obverse" },
    { suffix: "box", key: "image_box" },
    { suffix: "cert", key: "image_certificate" },
  ];
  const typeToUrl = { rev: byType.reverse, obv: byType.obverse, box: byType.box, cert: byType.certificate };
  const missing = [];
  for (const { suffix, key } of suffixToCoinKey) {
    if (!typeToUrl[suffix]) continue;
    const existingPath = existingCoin[key];
    if (existingPath) {
      const absPath = resolveImagePath(existingPath);
      if (absPath && fs.existsSync(absPath)) continue;
    }
    missing.push(suffix);
  }
  return missing;
}

/** Из URL пути вида .../coins/2026/26y15aaa/ или .../coins/01.-archive/2025/25117eaaa/ извлекаем { year, sku } или null */
function extractYearAndSku(imgUrl) {
  const str = String(imgUrl);
  const m = str.match(/\/coins\/(20\d{2})\/([a-z0-9]+)\//i) || str.match(/\/coins\/(\d{4})\/([a-z0-9]+)\//i);
  const archive = str.match(/\/coins\/01\.-archive\/(20\d{2}|19\d{2})\/([a-z0-9]+)\//i);
  if (archive) return { year: archive[1], sku: (archive[2] || "").toLowerCase() };
  if (!m) return null;
  return { year: m[1], sku: (m[2] || "").toLowerCase() };
}

/** Классификация по имени файла: obverse, reverse, box (деревянная), certificate (полноценная упаковка/outer). */
/** Исключаем повёрнутые/на ребре: в имени файла есть "on edge" или "left". */
function isExcludedImage(url) {
  const pathPart = String(url).split("?")[0].toLowerCase();
  return /on-edge|onedge|\bleft\b|left\.|left\-/.test(pathPart);
}

function imageType(url) {
  if (isExcludedImage(url)) return null;
  const lower = String(url).toLowerCase();
  const pathPart = lower.split("?")[0];
  if (/obverse|obv\.|obv-|\-obv\.|\-03\-/.test(pathPart)) return "obverse";
  // реверс: rev, reverse, 02-, а также straight-on/straight (обозначение реверса на части монет Perth)
  if (/rev\.|\-rev\.|reverse|straight\-on|straight\.|\-01\-|\-02\-/.test(pathPart) && !/obverse/.test(pathPart)) return "reverse";
  if (/\-outer\-|outer-left|packaging|danger|pack\./.test(pathPart)) return "certificate";
  if (/box|box-front|\-04\-|in-case|in-capsule/.test(pathPart)) return "box";
  if (/certificate|cert\.|\-cert\.|in-shipper/.test(pathPart)) return "certificate";
  return null;
}

/** Год из названия (например "Giant Centipede 2026" → 2026). */
function yearFromTitle(title) {
  if (!title || typeof title !== "string") return null;
  const m = String(title).match(/\b(20\d{2}|19\d{2})\b/);
  return m ? parseInt(m[1], 10) : null;
}

/** Проба: из спеок "Fineness (% purity)" / "Purity" или из текста. */
function normalizeFineness(data) {
  const specs = data.specs || {};
  const purityVal = (specs["Fineness (% purity)"] || specs["Purity"] || "").toString().replace(/\s/g, "");
  if (/99\.99|9999\/10000|9999/i.test(purityVal)) return "9999/10000";
  if (/99\.9|999\/1000/i.test(purityVal)) return "999/1000";
  if (/92\.5|925\/1000/i.test(purityVal)) return "925/1000";
  const text = [data.title, JSON.stringify(specs)].join(" ");
  if (/\b99\.99\s*%|9999\/10000|9\s*999\s*\/\s*10\s*000|99\.99\s*%\s*pure/i.test(text)) return "9999/10000";
  if (/\b99\.9\s*%|999\/1000/i.test(text)) return "999/1000";
  if (/\b92\.5\s*%|925\/1000/i.test(text)) return "925/1000";
  return null;
}

/** Металл из спеок. Bi Metal → по полям Gold/Silver/Platinum Content (напр. "Золото, Серебро" или "Золото, Платина"). */
function metalFromSpecs(specs) {
  if (!specs || typeof specs !== "object") return null;
  const v = (specs["Metal"] || "").toString().trim().toLowerCase();
  if (/bi\s*metal|биметалл/i.test(v)) {
    const has = (key) => specs[key] != null && String(specs[key]).trim() !== "";
    const parts = [];
    if (has("Gold Content (Troy oz)")) parts.push("Золото");
    if (has("Silver Content (Troy oz)")) parts.push("Серебро");
    if (has("Platinum Content (Troy oz)")) parts.push("Платина");
    if (has("Palladium Content (Troy oz)")) parts.push("Палладий");
    if (parts.length >= 2) return parts.join(", ");
    if (parts.length === 1) return parts[0];
  }
  if (/gold|золото/i.test(v)) return "Золото";
  if (/silver|серебро/i.test(v)) return "Серебро";
  if (/platinum|платин/i.test(v)) return "Платина";
  if (/palladium|палладий/i.test(v)) return "Палладий";
  return null;
}

/** Серия из URL товара: .../coins/<slug>/ → часть слага до года (20xx), в читаемый вид. */
function seriesFromUrl(url) {
  if (!url || typeof url !== "string") return null;
  const pathname = url.replace(/^https?:\/\/[^/]+/, "").replace(/\?.*$/, "").replace(/\/$/, "");
  const segments = pathname.split("/").filter(Boolean);
  const slug = segments[segments.length - 1];
  if (!slug || slug === "coins") return null;
  const parts = slug.split("-");
  const yearIdx = parts.findIndex((p) => /^20\d{2}$|^19\d{2}$/.test(p));
  const beforeYear = yearIdx >= 0 ? parts.slice(0, yearIdx) : parts;
  const take = beforeYear.length > 4 ? beforeYear.slice(0, 4) : beforeYear;
  if (take.length === 0) return null;
  const titleCase = (s) => s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
  return take.map(titleCase).join(" ");
}

/** Slug для файлов: только буквы, цифры, дефисы */
function slugify(s) {
  return String(s)
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "") || "perth-coin";
}

/** Уникальный slug из URL страницы: последний сегмент пути. 1 URL = 1 файл, без объединения разных монет. */
function slugFromUrl(pageUrl) {
  const pathname = String(pageUrl).replace(/^https?:\/\/[^/]+/, "").replace(/\?.*$/, "").replace(/\/$/, "");
  const segments = pathname.split("/").filter(Boolean);
  const last = segments[segments.length - 1] || "perth-coin";
  return last
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "") || "perth-coin";
}

const URL_LIST_FILE = path.join(__dirname, "perth-mint-urls.txt");
const REFETCH_URL_LIST_FILE = path.join(__dirname, "perth-mint-refetch-urls.txt");
const PROGRESS_FILE = path.join(DATA_DIR, "perth-mint-fetch-progress.json");
const IMAGE_URL_CACHE_FILE = path.join(DATA_DIR, "perth-mint-image-url-cache.json");

function loadImageUrlCache() {
  try {
    return JSON.parse(fs.readFileSync(IMAGE_URL_CACHE_FILE, "utf8"));
  } catch {
    return {};
  }
}

function saveImageUrlCache(cache) {
  fs.writeFileSync(IMAGE_URL_CACHE_FILE, JSON.stringify(cache, null, 2), "utf8");
}

/** Нормализуем URL для сравнения (без хвостового слэша). */
function normalizeUrl(u) {
  return String(u).trim().replace(/\/$/, "") || u;
}

/** Загружает прогресс: какие URL уже обработаны и список забранных монет. */
function loadProgress() {
  if (!fs.existsSync(PROGRESS_FILE)) return { completedUrls: [], coins: [] };
  try {
    const raw = JSON.parse(fs.readFileSync(PROGRESS_FILE, "utf8"));
    return {
      completedUrls: Array.isArray(raw.completedUrls) ? raw.completedUrls : [],
      coins: Array.isArray(raw.coins) ? raw.coins : [],
    };
  } catch {
    return { completedUrls: [], coins: [] };
  }
}

/** Сохраняет прогресс. */
function saveProgress(progress) {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  progress.lastUpdated = new Date().toISOString();
  fs.writeFileSync(PROGRESS_FILE, JSON.stringify(progress, null, 2), "utf8");
}

/** Читает список URL: из аргумента (один), из perth-mint-refetch-urls.txt (если --refetch-lost), иначе из perth-mint-urls.txt. */
function getUrlList() {
  const arg = process.argv[2];
  if (arg && arg.startsWith("http")) return [arg];
  const useRefetch = process.argv.includes("--refetch-lost");
  const file = useRefetch && fs.existsSync(REFETCH_URL_LIST_FILE) ? REFETCH_URL_LIST_FILE : URL_LIST_FILE;
  if (!fs.existsSync(file)) return useRefetch ? [] : [DEFAULT_URL];
  const text = fs.readFileSync(file, "utf8");
  return text
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter((s) => s && (s.startsWith("http://") || s.startsWith("https://")));
}

/** Обрабатывает одну страницу товара: загрузка, извлечение данных, сохранение JSON и картинок. */
async function fetchOneCoin(page, url, imageUrlCache = {}) {
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 });
  await page.waitForTimeout(3000);
  // Ждём галерею товара (rev, obverse, box), чтобы подтянулись data-src
  await page.waitForSelector(".product-gallery img, [class*='product-gallery'] img, [class*='slick'] img", { timeout: 8000 }).catch(() => {});
  await page.waitForTimeout(2000);

    // Извлекаем данные со страницы (блок Specifications: таблица или role="table")
    const data = await page.evaluate(() => {
      const getText = (sel) => {
        const el = document.querySelector(sel);
        return el ? el.textContent.trim() : "";
      };
      const title = getText("h1") || getText("[data-product-name]") || document.title;
      const specs = {};
      function addRow(key, val) {
        const k = key.replace(/\s+/g, " ").trim();
        const v = val.replace(/\s+/g, " ").trim();
        if (k && v) specs[k] = v;
      }
      document.querySelectorAll("table tr").forEach((tr) => {
        const th = tr.querySelector("th, td:first-child");
        const td = tr.querySelector("td:last-child, td:nth-child(2)");
        if (th && td) addRow(th.textContent, td.textContent);
      });
      document.querySelectorAll("[role='table'] [role='row']").forEach((row) => {
        const cells = row.querySelectorAll("[role='cell'], td, th");
        if (cells.length >= 2) addRow(cells[0].textContent, cells[1].textContent);
      });
      // Цена: из спеок (Price) или из блоков .price, [data-product-price]
      let price = getText("[data-product-price]") || getText(".product-price") || getText(".price") || getText("[data-price]");
      const priceFromSpec = specs["Price"] || specs["Product Price"];
      if (!price && priceFromSpec) price = priceFromSpec;
      if (price) price = price.replace(/\s+/g, " ").trim();
      // Картинки: приоритет — галерея товара (rev, obverse, box и т.д.), затем остальные
      const gallerySelectors = ".product-gallery img, [class*='product-gallery'] img, [class*='slick-slide'] img, .product-gallery_thumbnail img";
      const galleryImgs = Array.from(document.querySelectorAll(gallerySelectors))
        .map((img) => img.getAttribute("data-src") || img.src || (img.getAttribute("data-srcset") || "").split(/[\s,]+/).find((s) => s.startsWith("http") || s.startsWith("/")))
        .filter(Boolean);
      const fromAll = Array.from(document.querySelectorAll("img"))
        .map((img) => img.getAttribute("data-src") || img.src)
        .filter(Boolean);
      const allImgUrls = Array.from(new Set([...galleryImgs, ...fromAll])).filter(
        (u) => !u.includes("logo") && !u.includes("icon") && (u.includes("product") || u.includes("coin") || u.includes("perthmint") || u.match(/\/coins\/\d{4}\//) || u.match(/\.(jpg|jpeg|png|webp)/i))
      );
      return { title, specs, imageUrls: allImgUrls.length ? allImgUrls : [], price: price || null };
    });

    if (!data.imageUrls || data.imageUrls.length === 0) {
      // Fallback: любые img в main
      const more = await page.evaluate(() => {
        return Array.from(document.querySelectorAll("main img, [role='main'] img, img[src]"))
          .map((i) => i.src)
          .filter((s) => s && !s.includes("logo") && !s.includes("icon") && (s.endsWith(".jpg") || s.endsWith(".png") || s.endsWith(".webp") || s.includes("image") || s.includes("media")));
      });
      data.imageUrls = [...(data.imageUrls || []), ...more].filter((u, i, a) => a.indexOf(u) === i);
    }

    console.log("Заголовок:", data.title || "(не найден)");
    console.log("Спеки:", JSON.stringify(data.specs, null, 2));
    console.log("Найдено изображений:", data.imageUrls.length);

    // Нормализуем спеки из известного формата страницы (Perth Mint). Берём все варианты ключей, чтобы ничего не терять.
    const specs = data.specs || {};
    const getSpec = (...keys) => {
      for (const k of keys) {
        const v = specs[k];
        if (v != null && String(v).trim()) return String(v).replace(/\s+/g, " ").trim();
      }
      return "";
    };
    const getSpecNum = (...keys) => {
      const s = getSpec(...keys).replace(",", ".").trim();
      return s ? s : null;
    };
    const mintageMatch = getSpec("Maximum Mintage", "Mintage", "Maximum mintage").replace(/\s/g, "");
    const yearFromSpecsRaw = (getSpec("Year", "Year Date") || Object.entries(specs).find(([k]) => /^year$/i.test(String(k).trim()))?.[1] || "").trim();
    const yearMatch = /^(20\d{2}|19\d{2})$/.test(yearFromSpecsRaw) ? yearFromSpecsRaw : "";
    const weightMatch = getSpecNum("Minimum Gross Weight (g)", "Maximum Gross Weight (g)", "Minimum gross weight (g)");
    const diameterMatch = getSpecNum("Maximum Diameter (mm)", "Diameter (mm)", "Maximum diameter (mm)");
    const thicknessMatch = getSpecNum("Maximum Thickness (mm)", "Maximum thickness (mm)", "Maximum Thickness Including the Tiger (mm)");
    let lengthMatch = getSpecNum("Length (mm)", "Maximum Length (mm)");
    let widthMatch = getSpecNum("Width (mm)", "Maximum Width (mm)");
    const dimensionsStr = getSpec("Dimensions (mm)", "Maximum Dimensions");
    if ((!lengthMatch || !widthMatch) && dimensionsStr && /^\s*[\d.,]+\s*[x×]\s*[\d.,]+\s*$/i.test(dimensionsStr)) {
      const parts = dimensionsStr.split(/\s*[x×]\s*/i).map((s) => s.replace(",", ".").trim());
      if (parts.length >= 2 && !lengthMatch) lengthMatch = parts[0] || null;
      if (parts.length >= 2 && !widthMatch) widthMatch = parts[1] || null;
    }

    const yearFromTitleVal = yearFromTitle(data.title);
    const yearStr = yearMatch || (yearFromTitleVal != null ? String(yearFromTitleVal) : null) || "2026";
    // В БД храним как DATE (YYYY-01-01), как у российских монет — тогда экспорт просто берёт год из release_date
    const yearFromSpec = /^(20\d{2}|19\d{2})$/.test(yearStr) ? `${yearStr}-01-01` : yearStr;
    const skuFromSpec = (getSpec("Product Code", "SKU") || "").toLowerCase().replace(/\s/g, "");
    const fineness = normalizeFineness(data) || getSpec("Fineness (% purity)", "Purity") || "9999/10000";
    const fromTitle = deriveMetalAndWeightFromTitle(data.title);
    const metalFromSpec = metalFromSpecs(specs);
    const metal = metalFromSpec || fromTitle.metal || "Серебро";
    const finishSpec = (getSpec("Finish", "Quality") || "").toLowerCase();
    const quality = finishSpec ? (finishSpec.includes("colour") || finishSpec.includes("colored") ? "Proof, Coloured" : "Proof") : (fromTitle.quality || "Proof, Coloured");

    const seriesFromPage = seriesFromUrl(url);
    const legalTender = getSpec("Legal Tender");
    let country = normalizeLegalTender(legalTender) || "Австралия";
    // Australian Kookaburra — всегда Австралия (на сайте Perth иногда Legal Tender = Tuvalu, но для каталога показываем страну серии)
    if (/Kookaburra/i.test(data.title || "")) country = "Австралия";
    const denomTvd = getSpecNum("Monetary Denomination (TVD)");
    const denomAud = getSpecNum("Monetary Denomination (AUD)");
    const denomNzd = getSpecNum("Monetary Denomination (NZD)");
    const denomGbp = getSpecNum("Monetary Denomination (GBP)");
    const denomValue = country === "Великобритания" ? denomGbp : (country === "Тувалу" ? (denomTvd ?? denomAud) : (country === "Ниуэ" ? (denomNzd ?? denomAud) : (denomAud ?? denomTvd ?? denomNzd ?? denomGbp)));
    const faceValue = formatDenominationForFaceValue(denomValue, country) || null;
    const coin = {
      title: data.title || "Deadly and Dangerous - Australia's Giant Centipede 2026 1oz Silver Proof Coloured Coin",
      title_ru: null,
      country,
      series: seriesFromPage || "Deadly and Dangerous",
      face_value: faceValue || null,
      release_date: yearFromSpec,
      mint: "The Perth Mint",
      mint_short: "Perth Mint",
      metal,
      metal_fineness: fineness,
      mintage: mintageMatch ? parseInt(mintageMatch.replace(/\D/g, ""), 10) : 2500,
      weight_g: normalizeWeightG(weightMatch ? parseFloat(weightMatch) : (fromTitle.weight_g != null ? fromTitle.weight_g : 31.107)) ?? 31.1,
      weight_oz: fromTitle.weight_oz != null ? fromTitle.weight_oz : null,
      diameter_mm: diameterMatch ? (roundSpec(parseFloat(diameterMatch)) ?? null) : null,
      thickness_mm: thicknessMatch ? (roundSpec(parseFloat(thicknessMatch)) ?? null) : null,
      length_mm: lengthMatch ? (roundSpec(parseFloat(lengthMatch)) ?? null) : null,
      width_mm: widthMatch ? (roundSpec(parseFloat(widthMatch)) ?? null) : null,
      quality,
      catalog_number: null,
      catalog_suffix: skuFromSpec || null,
      price_display: (data.price && String(data.price).trim()) || null,
    };

    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    if (!fs.existsSync(FOREIGN_DIR)) fs.mkdirSync(FOREIGN_DIR, { recursive: true });

    // Нормализуем URL картинок и извлекаем SKU/год из пути (для фильтрации картинок этой монеты)
    const allUrls = (data.imageUrls || [])
      .map((u) => (String(u).startsWith("http") ? u : BASE_URL + u))
      .map((u) => u.replace(/width=\d+/gi, "width=2000"))
      .filter((u, i, a) => a.indexOf(u) === i);
    // Выбираем SKU/год по большинству: считаем вхождения (year, sku) из путей, в т.ч. 01.-archive/
    const skuCounts = {};
    allUrls.forEach((u) => {
      const x = extractYearAndSku(u);
      if (x && x.sku) {
        const key = x.year + "/" + x.sku;
        skuCounts[key] = (skuCounts[key] || 0) + 1;
      }
    });
    const best = Object.entries(skuCounts).sort((a, b) => b[1] - a[1])[0];
    const productYear = best ? best[0].split("/")[0] : yearStr;
    const productSku = best ? best[0].split("/")[1] : null;

    // Только картинки этого продукта: путь содержит тот же SKU (в т.ч. в 01.-archive)
    const productUrls = productSku
      ? allUrls.filter((u) => String(u).toLowerCase().includes("/" + productSku + "/"))
      : allUrls.filter((u) => /\/coins\/(\d{4}\/[a-z0-9]+|01\.-archive\/\d{4}\/[a-z0-9]+)\//i.test(u));
    let fallbackUrls = productUrls.length > 0 ? productUrls : allUrls.filter((u) => u.includes("product") || u.includes("coin") || u.includes("perthmint"));
    // Исключаем повёрнутые/на ребре: в имени "on edge" или "left"
    fallbackUrls = fallbackUrls.filter((u) => !isExcludedImage(u));

    // Порядок: сначала реверс (красивое изображение), потом аверс (год/орёл), потом коробка, сертификат
    const byType = { obverse: null, reverse: null, box: null, certificate: null };
    for (const typ of ["reverse", "obverse", "box", "certificate"]) {
      for (const u of fallbackUrls) {
        if (imageType(u) === typ) {
          byType[typ] = u;
          break;
        }
      }
    }
    // Если по имени не определилось — реверс и аверс из оставшихся (реверс приоритетнее)
    if (!byType.reverse && fallbackUrls.length > 0) byType.reverse = fallbackUrls.find((u) => /rev|reverse|02-/.test(String(u).toLowerCase())) || fallbackUrls[0];
    if (!byType.obverse && fallbackUrls.length > 0) byType.obverse = fallbackUrls.find((u) => /obv|obverse|01-|03-|obverse-highres/.test(String(u).toLowerCase()) && u !== byType.reverse) || fallbackUrls.find((u) => u !== byType.reverse) || fallbackUrls[1];

    if (!coin.catalog_number) coin.catalog_number = "AU-PERTH-" + productYear + (productSku ? "-" + productSku.toUpperCase() : "");
    coin.source_url = normalizeUrl(url);

    const fileSlug = slugFromUrl(url);
    const jsonPath = path.join(DATA_DIR, `perth-mint-${fileSlug}.json`);
    let existing = null;
    if (fs.existsSync(jsonPath)) {
      try {
        existing = JSON.parse(fs.readFileSync(jsonPath, "utf8"));
        if (!existing.coin) existing = null;
      } catch (e) {}
    }

    if (existing) {
      if (compareCoinSpecs(existing.coin, coin)) {
        const missing = getMissingImageSuffixes(existing.coin, byType, fileSlug);
        if (missing.length === 0) {
          console.log("Без изменений, пропуск.");
          return { url, catalog_number: coin.catalog_number, title: coin.title, jsonPath, status: "unchanged" };
        }
        console.log("Докачиваем только изображения:", missing.join(", "));
      } else {
        console.log("Обновляем данные (характеристики/название изменились).");
      }
    }

    console.log("SKU/год из картинок:", productSku || "(не найден)", productYear);
    console.log("Типы картинок: аверс=" + (byType.obverse ? "да" : "нет") + ", реверс=" + (byType.reverse ? "да" : "нет") + ", коробка=" + (byType.box ? "да" : "нет") + ", сертификат=" + (byType.certificate ? "да" : "нет"));

    const allToDownload = [
      { url: byType.reverse, suffix: "rev" },
      { url: byType.obverse, suffix: "obv" },
      { url: byType.box, suffix: "box" },
      { url: byType.certificate, suffix: "cert" },
    ].filter((x) => x.url);
    const missingSuffixes = existing ? getMissingImageSuffixes(existing.coin, byType, fileSlug) : allToDownload.map((x) => x.suffix);
    const toDownload = allToDownload.filter((x) => missingSuffixes.includes(x.suffix));

    const sharp = require("sharp");
    const MAX_SIDE = 1200;
    const saved = { obverse: null, reverse: null, box: null, certificate: null };
    if (existing && existing.coin) {
      if (!missingSuffixes.includes("rev")) saved.reverse = existing.coin.image_reverse || null;
      if (!missingSuffixes.includes("obv")) saved.obverse = existing.coin.image_obverse || null;
      if (!missingSuffixes.includes("box")) saved.box = existing.coin.image_box || null;
      if (!missingSuffixes.includes("cert")) saved.certificate = existing.coin.image_certificate || null;
    }

    for (const { url: imgUrl, suffix } of toDownload) {
      if (!imgUrl) continue;
      const cachedPath = imageUrlCache[imgUrl];
      if (cachedPath) {
        if (suffix === "obv") saved.obverse = cachedPath;
        else if (suffix === "rev") saved.reverse = cachedPath;
        else if (suffix === "box") saved.box = cachedPath;
        else if (suffix === "cert") saved.certificate = cachedPath;
        console.log("  (reuse)", path.basename(cachedPath));
        continue;
      }
      try {
        const res = await fetch(imgUrl, {
          headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36" },
          redirect: "follow",
        });
        if (!res.ok) {
          console.warn("  — HTTP", res.status, imgUrl.slice(0, 70) + "...");
          continue;
        }
        const buf = Buffer.from(await res.arrayBuffer());
        if (buf.length < 1000) continue;
        const baseName = `${fileSlug}-${suffix}`;
        const webpPath = path.join(FOREIGN_DIR, `${baseName}.webp`);
        await sharp(buf)
          .resize(MAX_SIDE, MAX_SIDE, { fit: "inside", withoutEnlargement: true })
          .webp({ quality: 82, effort: 6, smartSubsample: true })
          .toFile(webpPath);
        const relPath = "/image/coins/foreign/" + baseName + ".webp";
        imageUrlCache[imgUrl] = relPath;
        if (suffix === "obv") saved.obverse = relPath;
        else if (suffix === "rev") saved.reverse = relPath;
        else if (suffix === "box") saved.box = relPath;
        else if (suffix === "cert") saved.certificate = relPath;
        console.log("  ✓", baseName + ".webp");
      } catch (e) {
        console.warn("  —", imgUrl.slice(0, 60) + "...", e.message);
      }
    }

    coin.image_obverse = saved.obverse || null;
    coin.image_reverse = saved.reverse || saved.obverse || null;
    coin.image_box = saved.box || null;
    coin.image_certificate = saved.certificate || null;
    fs.writeFileSync(jsonPath, JSON.stringify({ coin, raw: data, saved }, null, 2), "utf8");

  console.log("\nГотово. Данные:", jsonPath);
  console.log("Изображения в", FOREIGN_DIR);
  const hasMainImage = !!(saved.obverse || saved.reverse);
  return { url, catalog_number: coin.catalog_number, title: coin.title, jsonPath, status: hasMainImage ? "ok" : "partial" };
}

async function main() {
  const allUrls = getUrlList();
  if (allUrls.length === 0) {
    console.log("Нет ссылок. Добавь URL в", URL_LIST_FILE, "или передай: node scripts/fetch-perth-mint-coin.js <url>");
    process.exit(1);
  }

  const refresh = process.argv.includes("--refresh");
  const progress = loadProgress();
  const completedSet = new Set(progress.completedUrls.map(normalizeUrl));
  const urls = refresh ? allUrls : allUrls.filter((u) => !completedSet.has(normalizeUrl(u)));

  if (refresh) console.log("Режим --refresh: обрабатываем все URL из списка (в т.ч. уже в прогрессе).");
  console.log("Монет в списке:", allUrls.length, "| уже в прогрессе:", progress.completedUrls.length, "| к обработке:", urls.length);
  if (urls.length === 0) {
    console.log("Все URL уже обработаны. Прогресс в", PROGRESS_FILE);
    return;
  }

  let chromium;
  let stealth;
  try {
    const playwrightExtra = require("playwright-extra");
    chromium = playwrightExtra.chromium;
    stealth = require("puppeteer-extra-plugin-stealth")();
    chromium.use(stealth);
  } catch (e) {
    console.error("Нужны: playwright, playwright-extra, puppeteer-extra-plugin-stealth");
    process.exit(1);
  }

  const browser = await chromium.launch({
    headless: process.env.HEADLESS !== "0",
    args: ["--disable-blink-features=AutomationControlled", "--no-sandbox"],
  });
  const context = await browser.newContext({
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    viewport: { width: 1280, height: 800 },
  });

  const noImageCache = process.argv.includes("--no-image-cache");
  const imageUrlCache = noImageCache ? {} : loadImageUrlCache();
  if (noImageCache) console.log("Режим --no-image-cache: все изображения загружаются заново.");
  let doneThisRun = 0;
  try {
    for (let i = 0; i < urls.length; i++) {
      const url = urls[i];
      console.log("\n——— " + (i + 1) + "/" + urls.length + " ———");
      console.log("Загрузка:", url);
      const page = await context.newPage();
      try {
        const result = await fetchOneCoin(page, url, imageUrlCache);
        if (result) {
          if (!noImageCache) saveImageUrlCache(imageUrlCache);
          const norm = normalizeUrl(url);
          const idx = progress.completedUrls.indexOf(norm);
          const entry = { url: norm, catalog_number: result.catalog_number, title: result.title, jsonPath: result.jsonPath, completedAt: new Date().toISOString(), status: result.status || "ok" };
          if (idx >= 0) {
            progress.coins[idx] = entry;
          } else {
            progress.completedUrls.push(norm);
            progress.coins.push(entry);
          }
          saveProgress(progress);
          doneThisRun++;
        }
      } catch (e) {
        console.error("Ошибка для", url, e.message);
      } finally {
        await page.close();
      }
      if (i < urls.length - 1) await new Promise((r) => setTimeout(r, 2000));
    }
  } finally {
    await browser.close();
  }
  console.log("\nОбработано в этом запуске:", doneThisRun);
  console.log("Всего в прогрессе:", progress.completedUrls.length, "монет. Файл:", PROGRESS_FILE);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
