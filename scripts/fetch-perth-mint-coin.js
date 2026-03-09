/**
 * Загружает страницу монеты Perth Mint по URL, извлекает данные и картинки.
 * URL страницы → только изображения ЭТОЙ монеты (не "you may also like").
 *
 * Логика: 1) картинки в порядке DOM; 2) папка продукта = самая частая в первых 20;
 * 3) оставляем только URL с этой папкой; 4) серия — только из breadcrumb (без fallback).
 *
 * Сохраняет изображения в public/image/coins/foreign/, данные — в data/perth-mint-*.json.
 * Типы картинок: аверс (obverse), реверс (reverse), коробка (box), сертификат (certificate) —
 * по имени файла; записываются в image_obverse, image_reverse, image_box, image_certificate.
 *
 * Запуск:
 *   node scripts/fetch-perth-mint-coin.js              — берёт ссылки из scripts/perth-mint-urls.txt, пропускает уже обработанные
 *   node scripts/fetch-perth-mint-coin.js <url>       — одна ссылка из аргумента
 *   node scripts/fetch-perth-mint-coin.js --from-canonicals — URL из data/perth-mint-*.json: для каждой страницы Perth сравнение с нашими данными, при расхождениях обновление; докачка недостающих изображений. 1 URL = 1 монета, дублей нет.
 *   node scripts/fetch-perth-mint-coin.js --missing       — URL из perth-mint-missing-in-db.txt (нет в БД, см. check-perth-urls-vs-db.js --write)
 *   node scripts/fetch-perth-mint-coin.js --refetch-lost --refresh — переспарсить «потерянные» URL из perth-mint-refetch-urls.txt (см. list-perth-mint-refetch-urls.js)
 *   node scripts/fetch-perth-mint-coin.js --refresh — полный перезабор: данные и картинки заново.
 *   node scripts/fetch-perth-mint-coin.js --from-start — начать с начала (игнорировать прогресс).
 *   Прогресс: data/perth-mint-fetch-progress.json. Ошибки: scripts/perth-mint-fetch-errors.txt. При повторе — продолжение с последнего успеха.
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
  // архив 2012-2020: путь .../01.-archive/2012-2020/y20022dpad/ — одна папка на диапазон лет
  const archive2012 = str.match(/\/coins\/01\.-archive\/2012-2020\/([a-z0-9]+)\//i);
  if (archive2012) return { year: "2020", sku: (archive2012[1] || "").toLowerCase() };
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
const MISSING_IN_DB_FILE = path.join(__dirname, "perth-mint-missing-in-db.txt");
const PROGRESS_FILE = path.join(DATA_DIR, "perth-mint-fetch-progress.json");
const ERRORS_FILE = path.join(__dirname, "perth-mint-fetch-errors.txt");

/** Нормализуем URL для сравнения (без хвостового слэша). */
function normalizeUrl(u) {
  return String(u).trim().replace(/\/$/, "") || u;
}

/** Загружает прогресс: какие URL уже обработаны и список забранных монет. */
function loadProgress() {
  if (!fs.existsSync(PROGRESS_FILE)) return { completedUrls: [], coins: [], errorUrls: [] };
  try {
    const raw = JSON.parse(fs.readFileSync(PROGRESS_FILE, "utf8"));
    return {
      completedUrls: Array.isArray(raw.completedUrls) ? raw.completedUrls : [],
      coins: Array.isArray(raw.coins) ? raw.coins : [],
      errorUrls: Array.isArray(raw.errorUrls) ? raw.errorUrls : [],
    };
  } catch {
    return { completedUrls: [], coins: [], errorUrls: [] };
  }
}

function appendErrorUrl(progress, url, errorMsg) {
  progress.errorUrls = progress.errorUrls || [];
  const norm = normalizeUrl(url);
  if (!progress.errorUrls.some((e) => normalizeUrl(e.url || e) === norm)) {
    progress.errorUrls.push({ url: norm, error: String(errorMsg || "").slice(0, 200), at: new Date().toISOString() });
    saveProgress(progress);
    fs.appendFileSync(ERRORS_FILE, norm + "\t" + (errorMsg || "") + "\n", "utf8");
  }
}

/** Сохраняет прогресс. */
function saveProgress(progress) {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  progress.lastUpdated = new Date().toISOString();
  fs.writeFileSync(PROGRESS_FILE, JSON.stringify(progress, null, 2), "utf8");
}

/** Собирает все source_url из каноников data/perth-mint-*.json. 1 URL = 1 монета, без дублей. */
function getUrlListFromCanonicals() {
  if (!fs.existsSync(DATA_DIR)) return [];
  const files = fs.readdirSync(DATA_DIR)
    .filter((f) => f.startsWith("perth-mint-") && f.endsWith(".json"));
  const seen = new Set();
  const urls = [];
  for (const f of files) {
    try {
      const raw = JSON.parse(fs.readFileSync(path.join(DATA_DIR, f), "utf8"));
      const url = raw?.coin?.source_url;
      if (!url || !String(url).includes("perthmint.com")) continue;
      const norm = normalizeUrl(url);
      if (seen.has(norm)) continue;
      seen.add(norm);
      urls.push(url.trim());
    } catch (e) {}
  }
  return urls;
}

/** Читает список URL: из аргумента (один), из каноников (--from-canonicals), из perth-mint-missing-in-db.txt (--missing), из perth-mint-refetch-urls.txt (--refetch-lost), иначе из perth-mint-urls.txt. */
function getUrlList() {
  const arg = process.argv[2];
  if (arg && arg.startsWith("http")) return [arg];
  if (process.argv.includes("--from-canonicals")) return getUrlListFromCanonicals();
  const useMissing = process.argv.includes("--missing");
  const useRefetch = process.argv.includes("--refetch-lost");
  let file = URL_LIST_FILE;
  if (useMissing && fs.existsSync(MISSING_IN_DB_FILE)) file = MISSING_IN_DB_FILE;
  else if (useRefetch && fs.existsSync(REFETCH_URL_LIST_FILE)) file = REFETCH_URL_LIST_FILE;
  if (!fs.existsSync(file)) return (useMissing || useRefetch) ? [] : [DEFAULT_URL];
  const text = fs.readFileSync(file, "utf8");
  return text
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter((s) => s && (s.startsWith("http://") || s.startsWith("https://")));
}

/** Обрабатывает одну страницу товара: загрузка, извлечение данных, сохранение JSON и картинок. */
/** forceRefresh: при true не пропускать «без изменений», всегда качать картинки и перезаписывать JSON. */
async function fetchOneCoin(page, url, forceRefresh = false) {
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 25000 });
  await page.waitForSelector(".product-gallery img", { timeout: 5000 }).catch(() => {});
  await page.waitForTimeout(1200);

    // Извлекаем данные со страницы (блок Specifications, pageMetadata breadcrumb)
    const data = await page.evaluate(() => {
      const getText = (sel) => {
        const el = document.querySelector(sel);
        return el ? el.textContent.trim() : "";
      };
      const title = getText("h1") || getText("[data-product-name]") || document.title;
      let series = null;
      const metaEl = document.getElementById("pageMetadataObject");
      if (metaEl) {
        try {
          const meta = JSON.parse(metaEl.textContent);
          const bc = meta.breadcrumb;
          if (Array.isArray(bc) && bc.length >= 3) {
            const last = bc[bc.length - 1];
            if (bc.length === 4 && (bc[2] === "Sovereigns" || bc[2] === "Coin Sets")) {
              series = bc[2] === "Sovereigns" ? "Gold Sovereign" : "Coin Sets";
            } else if (bc.length === 4 && last.includes(" - ")) {
              series = last.split(" - ")[0].trim();
            } else if (bc.length === 4 && bc[2] === "Coins" && /\b(20|19)\d{2}\b/.test(last)) {
              const m = last.match(/^(.+?)\s+(?:20|19)\d{2}/);
              series = m ? m[1].trim() : null;
            } else if (bc.length === 3 && /\b(20|19)\d{2}\b/.test(last)) {
              const m = last.match(/^(.+?)\s+(?:20|19)\d{2}/);
              series = m ? m[1].trim() : null;
            } else if (bc.length === 3 && !/^(Home|Collector coins|Coins)$/i.test(last)) {
              const m = last.match(/^(.+?)\s+(?:20|19)\d{2}/);
              series = m ? m[1].trim() : last;
            }
          }
        } catch (e) {}
      }
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
      // Картинки: только из блока .product-gallery (есть на каждой странице монеты; без "you may also like")
      const gallery = document.querySelector(".product-gallery");
      const galleryImgs = gallery ? Array.from(gallery.querySelectorAll("img")) : [];
      const isCoinImg = (u) => u && !u.includes("logo") && !u.includes("icon") && (u.includes("/coins/") || u.includes("product-images"));
      const urlsInOrder = [];
      for (const img of galleryImgs) {
        const u = img.getAttribute("data-src") || img.src || (img.getAttribute("data-srcset") || "").split(/[\s,]+/).find((s) => s && (s.startsWith("http") || s.startsWith("/")));
        if (u && isCoinImg(u)) urlsInOrder.push(u);
      }
      const allImgUrls = Array.from(new Set(urlsInOrder));
      return { title, specs, series, imageUrls: allImgUrls.length ? allImgUrls : [], price: price || null };
    });

    // Доп. фильтр по папке (все из .product-gallery — уже этого продукта; на всякий случай)
    const urlsOrdered = data.imageUrls || [];
    const GALLERY_HEAD = 20;
    const headForFolder = urlsOrdered.slice(0, GALLERY_HEAD);
    const folderCounts = {};
    headForFolder.forEach((u) => {
      const m = String(u).match(/\/coins\/(?:01\.-archive\/)?(?:20\d{2}|19\d{2}|2012-2020)\/([a-z0-9]+)\//i);
      if (m) {
        const f = m[1].toLowerCase();
        folderCounts[f] = (folderCounts[f] || 0) + 1;
      }
    });
    const productFolder = (() => {
      const entries = Object.entries(folderCounts).sort((a, b) => b[1] - a[1]);
      return entries[0] ? entries[0][0] : null;
    })();
    if (productFolder) {
      data.imageUrls = urlsOrdered.filter((u) => String(u).toLowerCase().includes("/" + productFolder + "/"));
    }
    if (!data.imageUrls || data.imageUrls.length === 0) {
      data.imageUrls = [];
    }

    console.log("Заголовок:", data.title || "(не найден)");
    console.log("Серия (из breadcrumb):", data.series != null ? data.series : "(не найдена на странице)");
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
      title: data.title || null,
      title_ru: null,
      country,
      series: data.series || null,
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
    // SKU продукта: в приоритете из спеок страницы (таблица Specifications), иначе по большинству путей картинок
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
    const productSkuFromImages = best ? best[0].split("/")[1] : null;
    const productSku = skuFromSpec || productSkuFromImages;
    // Фильтр картинок: сначала по SKU из спеок; если по нему пусто (на сайте папка картинок иногда с другим кодом) — по SKU из путей
    let productUrls = productSku
      ? allUrls.filter((u) => String(u).toLowerCase().includes("/" + productSku.toLowerCase() + "/"))
      : allUrls.filter((u) => /\/coins\/(\d{4}\/[a-z0-9]+|01\.-archive\/\d{4}\/[a-z0-9]+)\//i.test(u));
    if (productUrls.length === 0 && productSkuFromImages && productSkuFromImages !== productSku) {
      productUrls = allUrls.filter((u) => String(u).toLowerCase().includes("/" + productSkuFromImages + "/"));
    }
    let fallbackUrls = productUrls.length > 0 ? productUrls : allUrls.filter((u) => u.includes("product") || u.includes("coin") || u.includes("perthmint"));
    // Без fallback на «все»: если по SKU пусто — пробуем папку из путей (галерея в начале страницы)
    if (fallbackUrls.length === 0 && allUrls.length > 0) {
      const folderCounts = {};
      (allUrls.slice(0, 15) || []).forEach((u) => {
        const m = u.match(/\/coins\/(?:01\.-archive\/)?(?:20\d{2}|19\d{2}|2012-2020)\/([a-z0-9]+)\//i);
        if (m) {
          const f = m[1].toLowerCase();
          folderCounts[f] = (folderCounts[f] || 0) + 1;
        }
      });
      const best = Object.entries(folderCounts).sort((a, b) => b[1] - a[1])[0];
      if (best) fallbackUrls = allUrls.filter((u) => String(u).toLowerCase().includes("/" + best[0] + "/"));
    }
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
    // Один и тот же URL не должен быть и аверсом и реверсом (на сайте иногда одна картинка в галерее)
    if (byType.obverse && byType.obverse === byType.reverse) byType.obverse = null;

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

    if (existing && !forceRefresh) {
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
    if (forceRefresh) console.log("Режим --refresh: забираем данные и картинки заново.");

    console.log("SKU/год из картинок:", productSku || "(не найден)", productYear);
    console.log("Типы картинок: аверс=" + (byType.obverse ? "да" : "нет") + ", реверс=" + (byType.reverse ? "да" : "нет") + ", коробка=" + (byType.box ? "да" : "нет") + ", сертификат=" + (byType.certificate ? "да" : "нет"));

    const allToDownload = [
      { url: byType.reverse, suffix: "rev" },
      { url: byType.obverse, suffix: "obv" },
      { url: byType.box, suffix: "box" },
      { url: byType.certificate, suffix: "cert" },
    ].filter((x) => x.url);
    const missingSuffixes = forceRefresh ? allToDownload.map((x) => x.suffix) : (existing ? getMissingImageSuffixes(existing.coin, byType, fileSlug) : allToDownload.map((x) => x.suffix));
    const toDownload = allToDownload.filter((x) => missingSuffixes.includes(x.suffix));

    const sharp = require("sharp");
    const MAX_SIDE = 1200;
    const saved = { obverse: null, reverse: null, box: null, certificate: null };
    if (existing && existing.coin && !forceRefresh) {
      if (!missingSuffixes.includes("rev")) saved.reverse = existing.coin.image_reverse || null;
      if (!missingSuffixes.includes("obv")) saved.obverse = existing.coin.image_obverse || null;
      if (!missingSuffixes.includes("box")) saved.box = existing.coin.image_box || null;
      if (!missingSuffixes.includes("cert")) saved.certificate = existing.coin.image_certificate || null;
    }

    const downloadOne = async ({ url: imgUrl, suffix }) => {
      if (!imgUrl) return null;
      try {
        const res = await fetch(imgUrl, {
          headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36" },
          redirect: "follow",
        });
        if (!res.ok) return null;
        const buf = Buffer.from(await res.arrayBuffer());
        if (buf.length < 1000) return null;
        const baseName = `${fileSlug}-${suffix}`;
        const webpPath = path.join(FOREIGN_DIR, `${baseName}.webp`);
        await sharp(buf)
          .resize(MAX_SIDE, MAX_SIDE, { fit: "inside", withoutEnlargement: true })
          .webp({ quality: 82, effort: 6, smartSubsample: true })
          .toFile(webpPath);
        return { suffix, baseName };
      } catch (e) {
        return null;
      }
    };
    const results = await Promise.all(toDownload.map(downloadOne));
    for (const r of results) {
      if (!r) continue;
      const relPath = "/image/coins/foreign/" + r.baseName + ".webp";
      if (r.suffix === "obv") saved.obverse = relPath;
      else if (r.suffix === "rev") saved.reverse = relPath;
      else if (r.suffix === "box") saved.box = relPath;
      else if (r.suffix === "cert") saved.certificate = relPath;
      console.log("  ✓", r.baseName + ".webp");
    }

    coin.image_obverse = saved.obverse || null;
    coin.image_reverse = saved.reverse || null;
    coin.image_box = saved.box || null;
    coin.image_certificate = saved.certificate || null;
    // В raw — только картинки этой монеты (уже отфильтрованы по папке продукта)
    const rawToSave = { ...data, imageUrls: fallbackUrls };
    fs.writeFileSync(jsonPath, JSON.stringify({ coin, raw: rawToSave, saved }, null, 2), "utf8");

  console.log("\nГотово. Данные:", jsonPath);
  console.log("Изображения в", FOREIGN_DIR);
  const hasMainImage = !!(saved.obverse || saved.reverse);
  return { url, catalog_number: coin.catalog_number, title: coin.title, jsonPath, status: hasMainImage ? "ok" : "partial" };
}

async function main() {
  const allUrls = getUrlList();
  if (allUrls.length === 0) {
    if (process.argv.includes("--from-canonicals")) {
      console.log("В data/ нет каноников Perth с source_url (perthmint.com).");
    } else {
      console.log("Нет ссылок. Добавь URL в", URL_LIST_FILE, "или передай: node scripts/fetch-perth-mint-coin.js <url>");
    }
    process.exit(1);
  }

  const refresh = process.argv.includes("--refresh");
  const fromCanonicals = process.argv.includes("--from-canonicals");
  const fromStart = process.argv.includes("--from-start");
  const progress = loadProgress();
  const completedSet = new Set(progress.completedUrls.map(normalizeUrl));
  // Всегда возобновляем с последней удачной (кроме --from-start). Ошибки в perth-mint-fetch-errors.txt
  const urls = fromStart ? allUrls : allUrls.filter((u) => !completedSet.has(normalizeUrl(u)));

  if (fromStart) {
    console.log("Режим --from-start: игнорируем прогресс, начинаем с начала.");
    if (fs.existsSync(ERRORS_FILE)) fs.writeFileSync(ERRORS_FILE, "", "utf8");
  }
  if (refresh) console.log("Режим --refresh: перезаписываем данные и картинки.");
  console.log("Монет в списке:", allUrls.length, "| готово:", progress.completedUrls.length, "| к обработке:", urls.length);
  if (progress.errorUrls?.length) console.log("Ошибок в прошлых запусках:", progress.errorUrls.length, "→ scripts/perth-mint-fetch-errors.txt");
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

  let doneThisRun = 0;
  try {
    for (let i = 0; i < urls.length; i++) {
      const url = urls[i];
      console.log("\n——— " + (i + 1) + "/" + urls.length + " ———");
      console.log("Загрузка:", url);
      const page = await context.newPage();
      try {
        const result = await fetchOneCoin(page, url, refresh);
        if (result) {
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
        appendErrorUrl(progress, url, e.message);
      } finally {
        await page.close();
      }
      if (i < urls.length - 1) await new Promise((r) => setTimeout(r, 800));
    }
  } finally {
    await browser.close();
  }
  console.log("\nОбработано в этом запуске:", doneThisRun);
  console.log("Всего в прогрессе:", progress.completedUrls.length, "монет. Файл:", PROGRESS_FILE);
  if (process.argv.includes("--from-canonicals") && doneThisRun > 0) {
    console.log("Дальше: node scripts/update-perth-from-canonical-json.js → node scripts/export-coins-to-json.js → npm run build");
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
