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
 * Посмотреть монету на localhost (без БД) — одной командой:
 *   npm run royal-mint:preview
 *   npm run royal-mint:preview -- "https://www.royalmint.com/..."
 *   npm run dev → URL в консоли (по умолчанию /coins/991001/)
 * Вручную (два шага): npm run royal-mint:fetch-test → npm run royal-mint:local-catalog
 * Если slug другой без preview: npx tsx scripts/royal-mint-to-public-catalog.ts data/royal-mint-<slug>.json
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
  /** RM часто даёт только reverse-edge / obverse-edge — это всё же реверс/аверс, не отбрасываем. */
  if (/reverse-with-edge|reverse-edge/i.test(lower)) return "reverse";
  if (/obverse-with-edge|obverse-edge/i.test(lower)) return "obverse";
  /** shadow-edge — тот же ракурс, но «издалека» с тенью; классифицируем как obverse/reverse, но ниже отфильтруем если есть with-edge */
  if (/reverse-shadow-edge/i.test(lower)) return "reverse";
  if (/obverse-shadow-edge/i.test(lower)) return "obverse";
  if (/on-edge/i.test(lower) && !/obverse|reverse/i.test(lower)) return null;
  if (/reverse.*blister|reverse-blister/i.test(lower)) return "blister_reverse";
  if (/obverse.*blister|obverse-blister/i.test(lower)) return "blister_obverse";
  if (/reverse.*capsule|capsule.*reverse/i.test(lower)) return "blister_reverse";
  if (/obverse.*capsule|capsule.*obverse/i.test(lower)) return "blister_obverse";
  /** Trial of the Pyx и др.: *-blister-back.jpg / *-blister-front.jpg */
  if (/blister-back/i.test(lower)) return "blister_reverse";
  if (/blister-front/i.test(lower)) return "blister_obverse";
  if (/obverse.*latent|obverse-latent/i.test(lower)) return "obverse";
  /** Trial packshots: *-obv-tp25px80.jpg / *-rev-tp25px80.jpg */
  if (/-obv-|_obv-tp|\.obv\./i.test(lower) && !/-rev-|_rev-tp/i.test(lower)) return "obverse";
  if (/-rev-|_rev-tp|\.rev\./i.test(lower) && !/-obv-/i.test(lower)) return "reverse";
  if ((/\breverse\b|coin-reverse|-reverse\./i.test(lower) || /-reverse\.jpg/i.test(lower)) && !/obverse/i.test(lower)) return "reverse";
  if (/\bobverse\b|coin-obverse|-obverse\./i.test(lower) || /-obverse\.jpg/i.test(lower)) return "obverse";
  if (/case-left|case-right|acrylic-block|in-shipper|in-case-pack/i.test(lower)) return "box";
  if (/box|case|shipper|outer-pack|presentation/i.test(lower)) return "certificate";
  if (/blister|secure-pack|in-pack/i.test(lower)) return "box";
  return null;
}

/**
 * Только «товарные» картинки из витрины RM: _ecommerce/.../launches/... + product-images, .../products/...
 * или .../prods/... (часть invest bullion, напр. Tudor Beasts — иначе остаются только картинки «You might also like», Britannia).
 * (раньше требовали /invest/launches/ — у commemorative путь .../commemorative/.../launches/, из‑за этого
 * кандидатов не оставалось и брались все img со страницы, в т.ч. одинаковые bullion tube 2026).
 *
 * Отбор картинок — как у Perth (redownload-perth-images-from-raw.js): не по SKU в имени файла,
 * а по «папке продукта» в URL ассета. Считаем самый частый путь после /launches/ среди первых URL
 * галереи (как у Perth — первые 15), затем оставляем только URL с этой папкой.
 *
 * @param {{ year?: number|null, title?: string, quality?: string, pdpUrl?: string|null }} ctx
 */
const RM_GALLERY_HEAD_COUNT = 15;

/** Путь каталога товара на CDN: всё после /launches/ до имени файла (вкл. product-images/2oz-silver и products/gold-1-oz). */
function extractRoyalMintGalleryFolder(imgUrl) {
  const u = String(imgUrl).split("?")[0].toLowerCase();
  const marker = "/launches/";
  const idx = u.indexOf(marker);
  if (idx === -1) return null;
  const rest = u.slice(idx + marker.length);
  const segments = rest.split("/").filter(Boolean);
  if (segments.length < 2) return null;
  const last = segments[segments.length - 1];
  if (/\.(jpg|jpeg|png|webp)$/i.test(last)) segments.pop();
  if (segments.length === 0) return null;
  return segments.join("/");
}

function filterUrlsByProductGalleryFolder(urls, ctx = {}) {
  const title = String(ctx.title || "");
  const quality = String(ctx.quality || "");
  const year = ctx.year != null && Number.isFinite(ctx.year) ? ctx.year : null;
  const isProofLike =
    /\bproof\b/i.test(title) ||
    /\bcolou?red\b/i.test(title) ||
    /\bproof\b/i.test(quality);

  /**
   * Shop PDP (trial-of-the-pyx, monarch и т.д.): картинки в __rebrand/.../_historic-coins/...
   * без /launches/ — старый фильтр их отбрасывал и цеплял чужие карточки с главной.
   */
  function isRebrandHistoricShopProductImage(u) {
    const p = String(u).toLowerCase().split("?")[0];
    if (!/\.(jpg|jpeg|webp)$/i.test(p)) return false;
    if (!/\/globalassets\/__rebrand\/_structure\/shop\/editions\/_historic-coins\//i.test(p)) return false;
    if (/160x160|100x100|\/banners\/|\/_common\//i.test(p)) return false;
    if (/trm-logo|feefo/i.test(p)) return false;
    return true;
  }

  /** Trial PDP: packshots в collect/.../trial-of-the-pyx/images/ (не __rebrand/_historic-coins). */
  function isEcommerceTrialOfPyxPackshot(u) {
    const p = String(u).toLowerCase().split("?")[0];
    if (!/\.(jpg|jpeg|webp)$/i.test(p)) return false;
    if (!/\/trial-of-the-pyx\/images\//i.test(p)) return false;
    if (/example-packaging|160x160|100x100|\/banners\//i.test(p)) return false;
    return true;
  }

  const rebrandHistoric = urls.filter(isRebrandHistoricShopProductImage);
  const trialPackshots = urls.filter(isEcommerceTrialOfPyxPackshot);
  if (rebrandHistoric.length > 0 || trialPackshots.length > 0) {
    const seen = new Set();
    const merged = [];
    for (const u of [...rebrandHistoric, ...trialPackshots]) {
      const k = String(u).split("?")[0];
      if (seen.has(k)) continue;
      seen.add(k);
      merged.push(u);
    }
    return merged;
  }

  /**
   * Invest bullion (особенно world coins): настоящие фото в bullion/images/products/...
   * Если полагаться только на _ecommerce/.../launches/, по частоте папок часто выигрывает
   * чужой Britannia с блока «You might also be interested in».
   */
  function isBullionImagesProductAsset(u) {
    const p = String(u).toLowerCase().split("?")[0];
    if (!/\.(jpg|jpeg|webp)$/i.test(p)) return false;
    if (!/\/globalassets\/bullion\/images\/products\//i.test(p)) return false;
    if (/160x160|100x100|banner/i.test(p)) return false;
    return true;
  }

  function slugTokensForImageMatch(slug) {
    const stop = new Set([
      "coin",
      "coins",
      "silver",
      "gold",
      "platinum",
      "bullion",
      "proof",
      "piedfort",
      "brilliant",
      "uncirculated",
      "the",
      "and",
      "uk",
      "gbp",
      "pound",
    ]);
    return String(slug || "")
      .toLowerCase()
      .split("-")
      .filter((w) => w.length >= 3 && !stop.has(w) && !/^\d{4}$/.test(w) && !/^\d*oz$/i.test(w));
  }

  function bullionAssetMatchesSlug(u, slug) {
    const low = String(u).toLowerCase();
    const tokens = slugTokensForImageMatch(slug);
    if (tokens.length === 0) return false;
    let hits = 0;
    for (const t of tokens) {
      if (low.includes(t)) hits += 1;
    }
    const need = Math.min(2, tokens.length);
    return hits >= need;
  }

  const pdpForGallery = String(ctx.pdpUrl || "");
  const slugForGallery = pdpForGallery ? slugFromUrl(pdpForGallery) : "";
  if (/\/invest\/bullion\//i.test(pdpForGallery) && slugForGallery) {
    const bullionProducts = urls.filter(isBullionImagesProductAsset);
    const matchedBullion = bullionProducts.filter((u) => bullionAssetMatchesSlug(u, slugForGallery));
    if (matchedBullion.length > 0) {
      return matchedBullion;
    }
  }

  /**
   * Lunar / часть commemorative: фото в .../launches/2025-launches/theme---slug/*.jpg без product-images/.
   * Старый фильтр оставлял только product-images|products|prods → в candidates попадали чужие карусельные product-images.
   */
  function launchDirectProductShots(u) {
    const p = String(u).toLowerCase().split("?")[0];
    if (!/\.(jpg|jpeg|webp)$/i.test(p)) return false;
    if (!/\/globalassets\/_ecommerce\/.*\/launches\//i.test(p)) return false;
    if (/160x160|100x100|\/banners\//i.test(p)) return false;
    /** 2026 lunar и др.: только product-images с *-shadow-edge-f3a2c67.jpg (без 1500x1500 в имени). */
    if (
      !/1500x1500/i.test(p) &&
      !/-reverse-edge|-obverse-edge|-reverse-with-edge|-obverse-with-edge/i.test(p) &&
      !/-reverse-shadow-edge|-obverse-shadow-edge/i.test(p)
    ) {
      return false;
    }
    if (!slugForGallery || slugForGallery.length < 6) return false;
    return bullionAssetMatchesSlug(u, slugForGallery);
  }
  const directLaunchMatches = urls.filter(launchDirectProductShots);

  function isEcommerceLaunchProductAsset(u) {
    const p = String(u).toLowerCase();
    if (!/\.(jpg|jpeg|webp)(\?|$)/i.test(p)) return false;
    if (/160x160|100x100|\/banners\//i.test(p)) return false;
    if (!/\/globalassets\/_ecommerce\//i.test(p)) return false;
    if (!/\/launches\//i.test(p)) return false;
    return (
      p.includes("product-images") ||
      p.includes("/products/") ||
      /** Bullion PDP (desktop-product-pictures): .../launches/2025/tudor-beasts/prods/... */
      /\/prods\//i.test(p)
    );
  }

  let candidates = urls.filter(isEcommerceLaunchProductAsset);
  if (directLaunchMatches.length > 0) {
    candidates = directLaunchMatches;
  }

  /** Упаковка «tube» — для proof/coloured не подходит; часто это чужой bullion кадр. */
  if (isProofLike) {
    const noTube = candidates.filter((u) => !/-tube\.(jpg|jpeg|webp)/i.test(u) && !/-tube-/i.test(u));
    if (noTube.length) candidates = noTube;
    const noBullionFile = candidates.filter((u) => !/bullion/i.test(u.split("/").pop() || ""));
    if (noBullionFile.length) candidates = noBullionFile;
  }

  /** Год из спецификаций — отрезать чужие лаунчи (напр. 2026 bullion на странице 2025 proof). */
  if (year != null) {
    const y = String(year);
    const yy = y.slice(-2);
    const byYear = candidates.filter((u) => {
      const low = u.toLowerCase();
      const file = low.split("/").pop() || "";
      if (low.includes(`/${y}/`) || low.includes(`-${y}-`) || low.includes(`_${y}_`)) return true;
      if (file.includes(y)) return true;
      if (new RegExp(`${yy}[a-z]{1,3}---`, "i").test(file)) return true;
      if (new RegExp(`-${yy}-`, "i").test(file)) return true;
      return false;
    });
    if (byYear.length) candidates = byYear;
  }

  function bestFolderFromUrlList(list) {
    const counts = new Map();
    for (const u of list) {
      const f = extractRoyalMintGalleryFolder(u);
      if (f) counts.set(f, (counts.get(f) || 0) + 1);
    }
    let best = null;
    let nBest = 0;
    for (const [folder, n] of counts) {
      if (n > nBest) {
        nBest = n;
        best = folder;
      }
    }
    return best;
  }

  let bestFolder = bestFolderFromUrlList(candidates.slice(0, RM_GALLERY_HEAD_COUNT));
  /** Если в начале списка только логотипы/баннеры — считаем папки по всем кандидатам (как Perth, но над полным списком товарных URL). */
  if (!bestFolder) bestFolder = bestFolderFromUrlList(candidates);

  if (bestFolder) {
    const filtered = candidates.filter((u) => extractRoyalMintGalleryFolder(u) === bestFolder);
    if (filtered.length > 0) return filtered;
  }

  /** Fallback: slug PDP (как catalog_suffix) — только если он реально встречается в URL ассета. */
  const pdpUrl = ctx.pdpUrl || "";
  const slug = pdpUrl ? slugFromUrl(pdpUrl) : "";
  if (slug && slug.length >= 6) {
    const low = slug.toLowerCase();
    const bySlug = candidates.filter((u) => String(u).toLowerCase().includes(low));
    if (bySlug.length > 0) return bySlug;
  }

  return candidates.length > 0 ? candidates : urls;
}

/**
 * У RM часто две версии: *-shadow-edge.jpg (далеко, тень) и *-with-edge.jpg (крупнее, без лишней тени).
 * Если with-edge есть в списке — убираем парный shadow-edge (та же строка с заменой фрагмента).
 */
function preferWithEdgeOverShadowEdge(urls) {
  const norm = (u) => String(u).split("?")[0].toLowerCase();
  const set = new Set(urls.map(norm));
  return urls.filter((u) => {
    const n = norm(u);
    if (!/shadow-edge/i.test(n)) return true;
    const alt = n.replace(/shadow-edge/gi, "with-edge");
    return !set.has(alt);
  });
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
  /** Раньше брали самый длинный URL — shadow-edge длиннее with-edge и выигрывал. Сначала без shadow-edge. */
  const take = (arr) => {
    if (!arr.length) return null;
    const noShadow = arr.filter((x) => !/shadow-edge/i.test(String(x)));
    const pool = noShadow.length ? noShadow : arr;
    return pool.sort((a, b) => String(b).length - String(a).length)[0];
  };
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

    /** Порядок важен для голосования по папке CDN: сначала главная галерея (как .desktop-product-pictures в DevTools). */
    const orderedImgs = [];
    const seenImg = new Set();
    function pushImg(u) {
      const a = absUrl(u);
      if (!a || !/globalassets|royalmint\.com/i.test(a) || /data:/i.test(a)) return;
      if (seenImg.has(a)) return;
      seenImg.add(a);
      orderedImgs.push(a);
    }

    function pushFromImgEl(el) {
      let s = el.getAttribute("src") || el.getAttribute("data-src") || "";
      const srcset = el.getAttribute("srcset");
      if (srcset) {
        const first = srcset.split(",")[0].trim().split(/\s+/)[0];
        if (first) s = first;
      }
      if (s) pushImg(s);
    }

    document
      .querySelectorAll(
        ".desktop-product-pictures img, .desktop-product-pictures picture source, .mobile-product-pictures img, .mobile-product-pictures picture source"
      )
      .forEach(pushFromImgEl);

    const og = document.querySelector('meta[property="og:image"]')?.getAttribute("content");
    if (og) pushImg(og);

    document.querySelectorAll('img[src], img[data-src], picture source[srcset]').forEach(pushFromImgEl);

    return {
      title,
      specs,
      specificationBlockFound,
      price,
      imageUrls: orderedImgs,
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

  const releaseYearNum = yearMatch ? parseInt(yearMatch[1], 10) : null;
  let productUrls = filterUrlsByProductGalleryFolder(scraped.imageUrls || [], {
    year: releaseYearNum,
    title: scraped.title || "",
    quality: specs.Quality ? String(specs.Quality).trim() : "",
    pdpUrl: fetchUrl,
  });
  productUrls = preferWithEdgeOverShadowEdge(productUrls);
  const byType = pickBestByType(productUrls);
  /** Часть bullion PDP: в имени файла только reverse — дублируем, чтобы не было пустого аверса в каталоге. */
  if (!byType.obverse && byType.reverse) byType.obverse = byType.reverse;
  if (!byType.reverse && byType.obverse) byType.reverse = byType.obverse;
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

  // Для royal-mint-preview.js — одна строка для автозапуска local-catalog
  console.log("__RM_JSON__", jsonPath);

  console.log("\nГотово:", jsonPath);
  if (fetchUrl !== url) console.log("Исходная ссылка (listing):", url);
  console.log("Загрузка PDP:", fetchUrl);
  console.log("Классификация картинок:", JSON.stringify(byType, null, 2));

  console.log("\n────────── Как увидеть монету на сайте (localhost) ──────────");
  console.log("Быстро (парсинг + public/data в один заход): npm run royal-mint:preview");
  console.log("  (или уже есть JSON: npx tsx scripts/royal-mint-to-public-catalog.ts \"" + jsonPath + "\")");
  console.log("Потом: npm run dev → http://localhost:3000/coins/991001/ (или ROYAL_MINT_LOCAL_ID)");
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
