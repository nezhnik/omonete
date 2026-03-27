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
 *   node scripts/fetch-royal-mint-coin-test.js --no-db-spec-collision-check — не сверять с БД (или RM_SKIP_DB_SPEC_DUPLICATE_CHECK=1)
 *   node scripts/fetch-royal-mint-coin-test.js --allow-trial-of-pyx — парсить PDP Trial of the Pyx (нужно для URL без /archive/)
 *
 * По умолчанию URL с /trial-of-the-pyx/ пропускаются. Путь …/trial-of-the-pyx/archive/… часто отдаёт заглушку «Welcome» — в БД используйте …/trial-of-the-pyx/<slug> (без сегмента archive).
 *
 * Если задан DATABASE_URL: после парсинга сверка с монетами Royal Mint в БД по год+вес+металл+тираж (все поля
 * должны быть известны с обеих сторон). При совпадении — coin.duplicate_review и запись в
 * data/royal-mint-spec-collision-review.jsonl (монета не отбрасывается; сравни названия вручную).
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
  isRoyalMintTrialOfPyxUrl,
  getRoyalMintChromiumLaunchOptions,
  getRoyalMintBrowserContextOptions,
  applyRoyalMintPageHardening,
} = require("./royal-mint-listing-collect.js");
const { parseMintageFromSpecs, parseWeightGFromSpecs, checkRoyalMintSpecCollisions } = require("./royal-mint-spec-duplicate-lib.js");

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
  // В product filename бывает "...ticonic-..." (HMS Belfast), это не "icon" ассет.
  if (/(^|[\/._-])(logo|icon|feefo|payment|badge|ukas|placeholder|spacer)([\/._-]|$)|1x1|\.svg(\?|$)/i.test(lower)) return null;
  if (!/\.(jpg|jpeg|png|webp)(\?|$)/i.test(lower)) return null;
  if (/160x160|100x100|\/banners\//i.test(lower)) return null;
  /** RM часто даёт только reverse-edge / obverse-edge — это всё же реверс/аверс, не отбрасываем. */
  if (/reverse(?:-|_)with(?:-|_)edge|reverse-edge/i.test(lower)) return "reverse";
  if (/obverse(?:-|_)with(?:-|_)edge|obverse-edge/i.test(lower)) return "obverse";
  // BU/pack-shot кадры не являются сторонами монеты.
  if (/pack-front|pack-back/i.test(lower)) return null;
  /** shadow-edge — тот же ракурс, но «издалека» с тенью; классифицируем как obverse/reverse, но ниже отфильтруем если есть with-edge */
  if (/reverse(?:-|_)shadow(?:-|_)edge/i.test(lower)) return "reverse";
  if (/obverse(?:-|_)shadow(?:-|_)edge/i.test(lower)) return "obverse";
  /**
   * RM Portraits third effigy: в *-gold-proof-coin-reverse-case.jpg* на CDN фактически буклет BU/серебра — не реверс и не COA золотой proof.
   * Отдельного *-gold-proof-coin-case.jpg* у линии может не быть (404) — ассет исключаем из галереи.
   */
  if (/gold-proof.*reverse-case|reverse-case.*gold-proof/i.test(lower)) return null;
  /** Золотая монета в кейсе (без «reverse-» в имени) — как у Fourth effigy *-gold-proof-coin-case.jpg */
  if (/gold-proof.*-coin-case\.|coin-case.*gold-proof/i.test(lower) && !/reverse-case|obverse-case/i.test(lower))
    return "certificate";
  if (/gold-proof.*obverse-case|obverse-case.*gold-proof/i.test(lower)) return "certificate";
  if (/silver-proof.*reverse-case|reverse-case.*silver-proof|silver-piedfort.*reverse-case/i.test(lower))
    return "certificate";
  if (/reverse-case|obverse-case/i.test(lower)) return "box";
  if (/on-edge/i.test(lower) && !/obverse|reverse/i.test(lower)) return null;
  // На RM иногда встречаются опечатки в имени файла (например, "caosule"), тоже считаем капсулой.
  if (/capsule|caosule|casule|capsul/i.test(lower)) return null;
  if (/reverse.*blister|reverse-blister/i.test(lower)) return "blister_reverse";
  if (/obverse.*blister|obverse-blister/i.test(lower)) return "blister_obverse";
  /** Trial of the Pyx и др.: *-blister-back.jpg / *-blister-front.jpg */
  if (/blister-back/i.test(lower)) return "blister_reverse";
  if (/blister-front/i.test(lower)) return "blister_obverse";
  if (/obverse.*latent|obverse-latent/i.test(lower)) return "obverse";
  /** Коробка/упаковка для RM: если есть carton-кадры, складываем в certificate (как доп. инфо в конце галереи). */
  if (/carton|carton-upright|carton-flat/i.test(lower)) return "certificate";
  /** Trial packshots: *-obv-tp25px80.jpg / *-rev-tp25px80.jpg */
  if (/-obv-|_obv-tp|\.obv\./i.test(lower) && !/-rev-|_rev-tp/i.test(lower)) return "obverse";
  if (/-rev-|_rev-tp|\.rev\./i.test(lower) && !/-obv-/i.test(lower)) return "reverse";
  /** Historic/Trial naming: ...-obv.jpg / ...-rev.jpg / ..._obv.jpg */
  if (/(^|[-_.])obv(\.|-|_)/i.test(lower) && !/(^|[-_.])rev(\.|-|_)/i.test(lower)) return "obverse";
  if (/(^|[-_.])rev(\.|-|_)/i.test(lower) && !/(^|[-_.])obv(\.|-|_)/i.test(lower)) return "reverse";
  if (/(^|[-_.])reverse([-_.]|$)/i.test(lower) && !/(^|[-_.])obverse([-_.]|$)/i.test(lower)) return "reverse";
  if (/(^|[-_.])obverse([-_.]|$)/i.test(lower) && !/(^|[-_.])reverse([-_.]|$)/i.test(lower)) return "obverse";
  if ((/\breverse\b|coin-reverse|-reverse\./i.test(lower) || /-reverse\.jpg|reevsre|revsre/i.test(lower)) && !/obverse/i.test(lower)) return "reverse";
  if (/\bobverse\b|coin-obverse|-obverse\./i.test(lower) || /-obverse\.jpg/i.test(lower)) return "obverse";
  // Старые bullion-галереи RM: rtyb2310sc-1.png / -2.png без явных obverse/reverse в имени.
  if (/\/globalassets\/bullion\/images\/products\//i.test(lower)) {
    // Базовый кадр без суффикса -N обычно лицевая сторона (используем как obverse).
    if (!/-\d+\.(png|jpg|jpeg|webp)$/i.test(lower)) return "obverse";
    const n = lower.match(/-(\d+)\.(png|jpg|jpeg|webp)$/i)?.[1];
    if (n === "1") return "reverse";
    if (n === "2") return "obverse";
  }
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

/** Уникальные URL с сохранением порядка (ключ — путь без query). */
function uniqueUrlsStable(urls) {
  const seen = new Set();
  const out = [];
  for (const u of urls) {
    const k = String(u).split("?")[0].toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(u);
  }
  return out;
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
    if (!/\.(jpg|jpeg|png|webp)$/i.test(p)) return false;
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
      .filter((w) => w.length >= 3 && !stop.has(w) && !/^\d{4}$/.test(w));
  }

  function bullionAssetMatchesSlug(u, slug) {
    const low = String(u).toLowerCase().split("?")[0];
    const tail = low.includes("/globalassets/") ? low.split("/globalassets/")[1] : low;
    const tokens = slugTokensForImageMatch(slug);
    if (tokens.length === 0) return false;
    const esc = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    let hits = 0;
    for (const t of tokens) {
      const re = new RegExp(`(^|[^a-z0-9])${esc(t)}([^a-z0-9]|$)`, "i");
      if (re.test(tail)) hits += 1;
    }
    const need = tokens.length <= 2 ? 1 : 2;
    return hits >= need;
  }

  const pdpForGallery = String(ctx.pdpUrl || "");
  const slugForGallery = pdpForGallery ? slugFromUrl(pdpForGallery) : "";
  const desiredMetal = /\bsilver\b/i.test(`${title} ${pdpForGallery}`)
    ? "silver"
    : /\bgold\b/i.test(`${title} ${pdpForGallery}`)
      ? "gold"
      : null;
  const contextTokens = (() => {
    const stop = new Set([
      "shop",
      "invest",
      "collect",
      "discover",
      "limited",
      "editions",
      "edition",
      "collection",
      "commemorative",
      "bullion",
      "coins",
      "coin",
      "silver",
      "gold",
      "proof",
      "piedfort",
      "years",
      "the",
      "and",
      "uk",
      "of",
    ]);
    return String(pdpForGallery)
      .toLowerCase()
      .replace(/^https?:\/\/[^/]+/i, "")
      .replace(/\?.*$/, "")
      .split("/")
      .flatMap((s) => s.split("-"))
      .map((s) => s.trim())
      .filter((s) => s.length >= 4 && !stop.has(s) && !/^\d{4}$/.test(s));
  })();
  const hasContextToken = (u) => {
    const low = String(u).toLowerCase();
    let hits = 0;
    for (const t of contextTokens) {
      if (low.includes(t)) hits += 1;
    }
    const need = contextTokens.length <= 2 ? 1 : 2;
    return hits >= need;
  };
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
    if (!/\/globalassets\/(_?ecommerce\/.*\/launches\/|consumer\/_campaigns\/)/i.test(p)) return false;
    if (/160x160|100x100|\/banners\//i.test(p)) return false;
    /** 2026 lunar и др.: только product-images с *-shadow-edge-f3a2c67.jpg (без 1500x1500 в имени). */
    if (
      !/1500x1500/i.test(p) &&
      !/-reverse-edge|-obverse-edge|-reverse-with-edge|-obverse-with-edge/i.test(p) &&
      !/-reverse-shadow-edge|-obverse-shadow-edge/i.test(p) &&
      !/-reverse(\.|-)|-obverse(\.|-)/i.test(p)
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
    const isEcommerceLaunch = /\/globalassets\/_?ecommerce\//i.test(p) && /\/launches\//i.test(p);
    const isConsumerCampaign = /\/globalassets\/consumer\/_campaigns\//i.test(p);
    if (!isEcommerceLaunch && !isConsumerCampaign) return false;
    const looksLikeProductAsset = (
      p.includes("product-images") ||
      p.includes("/images/") ||
      p.includes("/products/") ||
      /** Commemorative shop: .../launches/.../theme/pdp-image/*.jpg */
      p.includes("/pdp-image/") ||
      /** Bullion PDP (desktop-product-pictures): .../launches/2025/tudor-beasts/prods/... */
      /\/prods\//i.test(p)
    );
    if (!looksLikeProductAsset) return false;
    // /images/ слишком широкая ветка; оставляем только "монетные" файлы, чтобы не подмешивать карусель/рекламу.
    if (
      p.includes("/images/") &&
      !/(obverse|reverse|with-edge|shadow-edge|case-|acrylic|carton|certificate|capsule|blister|pack-front|pack-back)/i.test(p)
    ) {
      return false;
    }
    return true;
  }

  let candidates = urls.filter(isEcommerceLaunchProductAsset);
  if (directLaunchMatches.length > 0) {
    candidates = directLaunchMatches;
  }
  if (desiredMetal) {
    const byMetal = candidates.filter((u) =>
      desiredMetal === "silver" ? !/\bgold\b/i.test(String(u)) : !/\bsilver\b/i.test(String(u))
    );
    if (byMetal.length > 0) candidates = byMetal;
  }
  // Для commemorative/shop PDP отсекаем чужие "You might also like" ассеты по токенам slug.
  if (slugForGallery && candidates.length > 0) {
    const byPdpTokens = candidates.filter((u) => bullionAssetMatchesSlug(u, slugForGallery));
    if (byPdpTokens.length > 0) candidates = byPdpTokens;
  }
  if (contextTokens.length > 0 && candidates.length > 0) {
    const byContext = candidates.filter((u) => hasContextToken(u));
    if (byContext.length > 0) {
      candidates = byContext;
    } else if (candidates.length <= 6) {
      // Небольшой пул без единого токена PDP — вероятно "You might also like".
      // Обнуляем, чтобы ниже сработал fallback из общего списка по контексту.
      candidates = [];
    }
  }

  /** Упаковка «tube» — для proof/coloured не подходит; часто это чужой bullion кадр. */
  if (isProofLike) {
    const noTube = candidates.filter((u) => !/-tube\.(jpg|jpeg|webp)/i.test(u) && !/-tube-/i.test(u));
    if (noTube.length) candidates = noTube;
    const noBullionFile = candidates.filter((u) => !/bullion/i.test(u.split("/").pop() || ""));
    if (noBullionFile.length) candidates = noBullionFile;
    // Для proof-страниц отсекаем BU/pack-shot кадры (часто подмешиваются из соседних карточек).
    const noBuPack = candidates.filter((u) => !/pack-front|pack-back|bu-pack/i.test(String(u)));
    if (noBuPack.length) candidates = noBuPack;
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

  // Fallback для collection/legacy PDP: если товарные кандидаты пустые или слишком узкие,
  // добираем из полного списка по контекстным токенам URL страницы.
  if (contextTokens.length > 0 && candidates.length <= 1) {
    const fromAll = urls.filter((u) => {
      const low = String(u).toLowerCase();
      if (!/\.(jpg|jpeg|png|webp)(\?|$)/i.test(low)) return false;
      if (/160x160|100x100|\/banners\//i.test(low)) return false;
      if (!/\/globalassets\//i.test(low)) return false;
      return hasContextToken(u);
    });
    if (fromAll.length > 0) return uniqueUrlsStable(fromAll);
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

function pickBestByType(urls, ctx = {}) {
  const pdpMetal = ctx.pdpMetal || null;
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
  const take = (arr, role) => {
    if (!arr.length) return null;
    const noShadow = arr.filter((x) => !/shadow-edge/i.test(String(x)));
    let pool = noShadow.length ? noShadow : arr;
    if (
      pdpMetal === "gold" &&
      (role === "certificate" || role === "box")
    ) {
      const f = pool.filter(
        (x) => !/silver-proof|silver-bullion|silver-piedfort|silver-proof-piedfort/i.test(String(x))
      );
      if (f.length) pool = f;
    }
    /** Золотой proof: не подставлять BU-упаковку (uk…bu---, brilliant-uncirculated); иначе пустой слот. */
    if (pdpMetal === "gold" && role === "box") {
      pool = pool.filter(
        (x) =>
          !/brilliant-uncirculated|\/uk\d{2}[a-z0-9]*bu---|-bu-pack|bu-coin-pack/i.test(String(x))
      );
    }
    if (
      pdpMetal === "silver" &&
      (role === "certificate" || role === "box")
    ) {
      const f = pool.filter((x) => !/gold-proof|gold-bullion/i.test(String(x)));
      if (f.length) pool = f;
    }
    /** Золотой PDP: не использовать piedfort-картон (uk…pf---…), даже если других cert в пуле нет. */
    if (pdpMetal === "gold" && role === "certificate") {
      pool = pool.filter((x) => !/\/uk\d{2}[a-z0-9]*pf---/i.test(String(x)));
    }
    if (role === "obverse" || role === "reverse") {
      const noEdge = pool.filter((x) => !/(^|[^a-z])edge([^a-z]|$)/i.test(String(x)));
      if (noEdge.length) pool = noEdge;
      // Старые bullion-сеты вида rtyb2310sc.png + rtyb2310sc-1..5.png:
      // для obverse приоритет у "базового" файла без -N, для reverse — у -1.
      const isBullion = (x) => /\/globalassets\/bullion\/images\/products\//i.test(String(x));
      const isIndexed = (x) => /-\d+\.(png|jpg|jpeg|webp)(\?|$)/i.test(String(x));
      if (role === "obverse") {
        const baseBullion = pool.filter((x) => isBullion(x) && !isIndexed(x));
        if (baseBullion.length) pool = baseBullion;
      } else if (role === "reverse") {
        const rev1Bullion = pool.filter((x) => isBullion(x) && /-1\.(png|jpg|jpeg|webp)(\?|$)/i.test(String(x)));
        if (rev1Bullion.length) pool = rev1Bullion;
      }
    }
    return pool.sort((a, b) => String(b).length - String(a).length)[0];
  };
  return {
    obverse: take(by.obverse, "obverse"),
    reverse: take(by.reverse, "reverse"),
    blister_obverse: take(by.blister_obverse, "blister_obverse"),
    blister_reverse: take(by.blister_reverse, "blister_reverse"),
    box: take(by.box, "box"),
    certificate: take(by.certificate, "certificate"),
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

/**
 * Металл товара по URL PDP, заголовку и спекам — чтобы в certificate/box не попадали чужие silver/gold ассеты с той же страницы.
 */
function pdpMetalHint(fetchUrl, title, specs) {
  const u = String(fetchUrl || "")
    .toLowerCase()
    .split("?")[0];
  const t = String(title || "").toLowerCase();
  const alloy = String((specs && (specs.Alloy || specs["Pure Metal Type"])) || "").toLowerCase();
  const silUrl =
    /silver-proof|silver-bullion|silver-piedfort|silver-proof-piedfort/.test(u) ||
    (/-silver-|\/silver-/i.test(u) && /proof|bullion|piedfort|coin/.test(u));
  const golUrl =
    /gold-proof|gold-bullion/.test(u) ||
    (/\/sovereign\//i.test(u) && !/silver/i.test(u)) ||
    (/sovereign/i.test(u) &&
      /gold|half-sovereign|double-sovereign|quintuple|five-sovereign/i.test(u) &&
      !/silver/i.test(u));
  if (silUrl && golUrl) return null;
  if (silUrl) return "silver";
  if (golUrl) return "gold";
  if (/916\.67\s*gold|999\.9|fine gold|^gold\b|\bgold\s/i.test(alloy)) return "gold";
  if (/\bsilver\b/i.test(alloy)) return "silver";
  if (/\bgold proof\b|\bgold bullion\b/.test(t)) return "gold";
  if (/\bsilver proof\b|\bsilver bullion\b|silver proof piedfort|silver-proof/i.test(t)) return "silver";
  return null;
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

    /** Порядок важен для голосования по папке CDN: сначала витрина Shop — div.image-gallery.fluid-image (как на PDP). */
    const fluidGalleryImgs = [];
    const seenFluid = new Set();
    function pushFluid(u) {
      const a = absUrl(u);
      if (!a || !/globalassets|royalmint\.com/i.test(a) || /data:/i.test(a)) return;
      if (seenFluid.has(a)) return;
      seenFluid.add(a);
      fluidGalleryImgs.push(a);
    }

    /** Берём самый крупный URL из srcset (1x, 2x, …w), иначе первый кандидат. */
    function urlFromSrcset(srcset) {
      if (!srcset || !String(srcset).trim()) return "";
      const parts = String(srcset)
        .split(",")
        .map((x) => x.trim())
        .filter(Boolean);
      let bestW = -1;
      let bestU = "";
      for (const part of parts) {
        const segs = part.split(/\s+/);
        const u = segs[0];
        if (!u) continue;
        let w = 0;
        const desc = segs[1];
        if (desc && /^(\d+)w$/i.test(desc)) w = parseInt(RegExp.$1, 10);
        else if (desc && /^(\d+(?:\.\d+)?)x$/i.test(desc)) w = Math.round(parseFloat(RegExp.$1) * 1000);
        if (w >= bestW) {
          bestW = w;
          bestU = u;
        }
      }
      if (bestU) return bestU;
      const first = parts[0].split(/\s+/)[0];
      return first || "";
    }

    function pushFromImgElFluid(el) {
      let s =
        el.getAttribute("data-src") ||
        el.getAttribute("data-lazy-src") ||
        el.getAttribute("src") ||
        "";
      const srcset = el.getAttribute("srcset") || el.getAttribute("data-srcset");
      const fromSet = urlFromSrcset(srcset);
      if (fromSet) s = fromSet;
      if (s) pushFluid(s);
    }

    const fluidRoots = document.querySelectorAll(".image-gallery.fluid-image, .fluid-image.image-gallery");
    fluidRoots.forEach((root) => {
      root.querySelectorAll("img, picture source").forEach(pushFromImgElFluid);
      root.querySelectorAll("[data-src],[data-lazy-src]").forEach((el) => {
        if (el.tagName === "IMG" || el.tagName === "SOURCE") return;
        const v =
          el.getAttribute("data-src") || el.getAttribute("data-lazy-src") || el.getAttribute("data-bg") || "";
        if (v) pushFluid(v);
      });
    });

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
      let s =
        el.getAttribute("data-src") ||
        el.getAttribute("data-lazy-src") ||
        el.getAttribute("src") ||
        "";
      const srcset = el.getAttribute("srcset") || el.getAttribute("data-srcset");
      const fromSet = urlFromSrcset(srcset);
      if (fromSet) s = fromSet;
      if (s) pushImg(s);
    }
    function pushFromBackgroundLikeEl(el) {
      const attrs = [
        "data-src",
        "data-original",
        "data-image",
        "data-bg",
        "data-background-image",
        "data-lazy",
      ];
      for (const a of attrs) {
        const v = el.getAttribute(a);
        if (v) pushImg(v);
      }
      const style = el.getAttribute("style") || "";
      const re = /url\((['"]?)([^'")]+)\1\)/gi;
      let m;
      while ((m = re.exec(style)) !== null) {
        if (m[2]) pushImg(m[2]);
      }
    }

    document
      .querySelectorAll(
        ".desktop-product-pictures img, .desktop-product-pictures picture source, .mobile-product-pictures img, .mobile-product-pictures picture source"
      )
      .forEach(pushFromImgEl);
    /** Один контейнер с двумя классами: div.image-gallery.fluid-image (Shop / limited editions) */
    document
      .querySelectorAll(
        ".image-gallery.fluid-image img, .image-gallery.fluid-image picture source, .fluid-image.image-gallery img, .fluid-image.image-gallery picture source"
      )
      .forEach(pushFromImgEl);
    document
      .querySelectorAll(
        ".image-gallery .fluid-image, .image-gallery.fluid-image, .fluid-image.image-gallery, .image-gallery [style*='background-image'], .product-gallery .fluid-image, .product-gallery [style*='background-image']"
      )
      .forEach(pushFromBackgroundLikeEl);

    const og = document.querySelector('meta[property="og:image"]')?.getAttribute("content");
    if (og) pushImg(og);

    document
      .querySelectorAll("img[src], img[data-src], img[data-lazy-src], picture source[srcset], picture source[data-srcset]")
      .forEach(pushFromImgEl);
    document
      .querySelectorAll("[style*='background-image'], [data-background-image], [data-bg], [data-image], [data-original]")
      .forEach(pushFromBackgroundLikeEl);

    const seenMerge = new Set();
    const imageUrlsMerged = [];
    for (const u of fluidGalleryImgs) {
      if (seenMerge.has(u)) continue;
      seenMerge.add(u);
      imageUrlsMerged.push(u);
    }
    for (const u of orderedImgs) {
      if (seenMerge.has(u)) continue;
      seenMerge.add(u);
      imageUrlsMerged.push(u);
    }

    return {
      title,
      specs,
      specificationBlockFound,
      price,
      imageUrls: imageUrlsMerged,
      imageUrlsFluidGallery: fluidGalleryImgs,
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

function extractRoyalMintImageUrlsFromHtml(html) {
  const out = [];
  const seen = new Set();
  const push = (u) => {
    const n = String(u || "").replace(/\\u002f/gi, "/").replace(/\\\//g, "/").trim();
    if (!/^https?:\/\/www\.royalmint\.com\/globalassets\//i.test(n)) return;
    if (!/\.(jpg|jpeg|png|webp)(\?|$)/i.test(n)) return;
    const key = n.split("?")[0];
    if (seen.has(key)) return;
    seen.add(key);
    out.push(key);
  };

  const direct = html.match(/https?:\/\/www\.royalmint\.com\/globalassets\/[^"'\\\s<>()]+\.(?:jpg|jpeg|png|webp)(?:\?[^"'\\\s<>()]*)?/gi) || [];
  direct.forEach(push);

  const escaped = html.match(/https?:\\\/\\\/www\.royalmint\.com\\\/globalassets\\\/[^"'\\\s<>()]+\.(?:jpg|jpeg|png|webp)(?:\\\?[^"'\\\s<>()]*)?/gi) || [];
  escaped.forEach(push);

  return out;
}

async function main() {
  const noImages = process.argv.includes("--no-images");
  const allowGradedSlab = process.argv.includes("--allow-graded-slab");
  const allowCoinBox = process.argv.includes("--allow-coin-box");
  const allowTrialOfPyx = process.argv.includes("--allow-trial-of-pyx");
  const urlArg = process.argv.find((a) => a.startsWith("http"));
  const url = urlArg || DEFAULT_URL;
  const preferSilver = /\bsilver\b|ss360query=silver/i.test(url);
  const fetchUrl = rewriteShopPdpToInvestBullion(url, { preferSilver });
  const fileSlug = slugFromUrl(fetchUrl);

  if (
    !allowTrialOfPyx &&
    (isRoyalMintTrialOfPyxUrl(url) || isRoyalMintTrialOfPyxUrl(fetchUrl))
  ) {
    const jsonPath = path.join(DATA_DIR, `royal-mint-${fileSlug}-skipped-trial-of-pyx.json`);
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(
      jsonPath,
      JSON.stringify(
        {
          skipped: true,
          reason: "trial_of_the_pyx_url",
          note: "Раздел Trial of the Pyx на royalmint.com не парсим (часто заглушка Welcome).",
          requestedUrl: url,
          pdpUrl: fetchUrl,
        },
        null,
        2
      ),
      "utf8"
    );
    console.warn("Пропуск: URL относится к Trial of the Pyx (не парсим).");
    console.warn("Файл:", jsonPath);
    process.exit(0);
  }

  const { chromium } = require("playwright");
  const browser = await chromium.launch(getRoyalMintChromiumLaunchOptions());
  const context = await browser.newContext(getRoyalMintBrowserContextOptions());
  const page = await context.newPage();
  await applyRoyalMintPageHardening(page);

  let scraped;
  try {
    await page.goto(fetchUrl, { waitUntil: "domcontentloaded", timeout: 120000 });
    await page
      .waitForSelector(".image-gallery.fluid-image img, .fluid-image.image-gallery img, .desktop-product-pictures img", {
        timeout: 25000,
      })
      .catch(() => {});
    await page.evaluate(() => {
      document.querySelectorAll(".image-gallery.fluid-image img, .fluid-image.image-gallery img").forEach((img) => {
        try {
          img.scrollIntoView({ block: "center", inline: "nearest" });
        } catch {
          /* ignore */
        }
      });
    });
    await new Promise((r) => setTimeout(r, 1500));
    scraped = await extractPage(page);
    const pageHtml = await page.content();
    const htmlImageUrls = extractRoyalMintImageUrlsFromHtml(pageHtml);
    if (htmlImageUrls.length > 0) {
      const merged = [];
      const seen = new Set();
      for (const u of [...(scraped.imageUrls || []), ...htmlImageUrls]) {
        const key = String(u).split("?")[0];
        if (!key || seen.has(key)) continue;
        seen.add(key);
        merged.push(key);
      }
      scraped.imageUrls = merged;
    }
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

  let weightG = troyOzToG(specs["Pure Metal Content"] || specs["Silver Content (Troy oz)"] || specs["Gold Content (Troy oz)"]);
  if (weightG == null) weightG = parseWeightGFromSpecs(specs);
  const diameterMm = parseDiameter(specs);
  const mintParsed = parseMintageFromSpecs(specs);

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
    mintage: mintParsed.mintage,
    mintage_display: mintParsed.mintage_display,
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
  /** Сначала URL из div.image-gallery.fluid-image (порядок как на сайте), затем полный список — для выбора папки CDN и productUrls. */
  const fluidGalleryForFilter = (scraped.imageUrlsFluidGallery || []).filter((u) => {
    const p = String(u).toLowerCase().split("?")[0];
    if (!/\/globalassets\/_?ecommerce\/.*\/launches\//i.test(p)) return false;
    if (!/\.(jpg|jpeg|webp)$/i.test(p)) return false;
    if (/160x160|100x100|\/banners\//i.test(p)) return false;
    return true;
  });
  const urlsForProductFilter =
    fluidGalleryForFilter.length >= 2
      ? uniqueUrlsStable([...fluidGalleryForFilter, ...(scraped.imageUrls || [])])
      : scraped.imageUrls || [];
  let productUrls = filterUrlsByProductGalleryFolder(urlsForProductFilter, {
    year: releaseYearNum,
    title: scraped.title || "",
    quality: specs.Quality ? String(specs.Quality).trim() : "",
    pdpUrl: fetchUrl,
  });
  productUrls = preferWithEdgeOverShadowEdge(productUrls);
  const pdpMetal = pdpMetalHint(fetchUrl, scraped.title, specs);
  const byType = pickBestByType(productUrls, { pdpMetal });
  const pdpContextTokens = (() => {
    const stop = new Set([
      "shop",
      "invest",
      "collect",
      "discover",
      "limited",
      "editions",
      "edition",
      "collection",
      "commemorative",
      "bullion",
      "coins",
      "coin",
      "silver",
      "gold",
      "proof",
      "piedfort",
      "years",
      "the",
      "and",
      "uk",
      "of",
    ]);
    return String(fetchUrl || "")
      .toLowerCase()
      .replace(/^https?:\/\/[^/]+/i, "")
      .replace(/\?.*$/, "")
      .split("/")
      .flatMap((s) => s.split("-"))
      .map((s) => s.trim())
      .filter((s) => s.length >= 4 && !stop.has(s) && !/^\d{4}$/.test(s));
  })();
  const matchesPdpContext = (u) => {
    const low = String(u || "").toLowerCase();
    if (!low) return false;
    let hits = 0;
    for (const t of pdpContextTokens) {
      if (low.includes(t)) hits += 1;
    }
    const need = pdpContextTokens.length <= 2 ? 1 : 2;
    return hits >= need;
  };
  // Если первичный выбор не связан с текущим PDP (часто подмешивается "You might also like"),
  // пересобираем стороны из полного списка URL по контексту страницы.
  if (pdpContextTokens.length > 0) {
    const chosen = [byType.obverse, byType.reverse].filter(Boolean);
    const hasContextInChosen = chosen.some((u) => matchesPdpContext(u));
    if (!hasContextInChosen || !byType.obverse || !byType.reverse) {
      const contextUrls = (scraped.imageUrls || []).filter((u) => matchesPdpContext(u));
      if (contextUrls.length > 0) {
        const byContextType = pickBestByType(contextUrls, { pdpMetal });
        if (byContextType.obverse) byType.obverse = byContextType.obverse;
        if (byContextType.reverse) byType.reverse = byContextType.reverse;
        if (!byType.box && byContextType.box) byType.box = byContextType.box;
        if (!byType.certificate && byContextType.certificate) byType.certificate = byContextType.certificate;
      }
    }
  }
  // Если product subset узкий (иногда только 1 сторона), добираем недостающее только из той же папки ассетов.
  const familySeed = byType.obverse || byType.reverse || byType.box || byType.certificate || null;
  if (familySeed && (!byType.obverse || !byType.reverse || !byType.box || !byType.certificate)) {
    const familyFolder = String(familySeed).split("?")[0].split("/").slice(0, -1).join("/");
    const familyUrls = (scraped.imageUrls || []).filter((u) => String(u).startsWith(familyFolder + "/"));
    const familyByType = pickBestByType(familyUrls, { pdpMetal });
    if (!byType.obverse && familyByType.obverse) byType.obverse = familyByType.obverse;
    if (!byType.reverse && familyByType.reverse) byType.reverse = familyByType.reverse;
    if (!byType.box && familyByType.box) byType.box = familyByType.box;
    if (!byType.certificate && familyByType.certificate) byType.certificate = familyByType.certificate;
  }
  /**
   * Legacy RM campaigns (consumer/_campaigns, __rebrand/_campaigns):
   * стороны часто помечены как "_reverse_" / "_obverse_" в имени файла и
   * не всегда попадают в product folder filter. Подбираем только крупные asset URL.
   */
  if (!byType.obverse || !byType.reverse) {
    const legacyCampaignSides = (scraped.imageUrls || []).filter((u) => {
      const p = String(u || "").toLowerCase().split("?")[0];
      if (!/\/globalassets\/(?:consumer|__rebrand)\/_campaigns\//i.test(p)) return false;
      if (!/\.(jpg|jpeg|png|webp)$/i.test(p)) return false;
      if (/160x160|100x100|\/banners\//i.test(p)) return false;
      return (
        /(^|[_\-.\/])obverse([_\-.\/]|$)|(^|[_\-.\/])reverse([_\-.\/]|$)|coin[_-]obverse|coin[_-]reverse/i.test(p)
      );
    });
    if (legacyCampaignSides.length > 0) {
      const legacyByType = pickBestByType(legacyCampaignSides, { pdpMetal });
      if (!byType.obverse && legacyByType.obverse) byType.obverse = legacyByType.obverse;
      if (!byType.reverse && legacyByType.reverse) byType.reverse = legacyByType.reverse;
    }
  }
  /**
   * Historic Coins PDP: иногда только "_historic-coins/_product-image" кадры без явных ролей.
   * Берём только URL, которые совпадают с токенами текущего PDP, чтобы не тянуть чужие картинки.
   */
  if (!byType.obverse && !byType.reverse) {
    const historicProductImgs = (scraped.imageUrls || []).filter((u) => {
      const p = String(u || "").toLowerCase().split("?")[0];
      if (!/\/globalassets\/__rebrand\/_structure\/shop\/editions\/_historic-coins\/_product-image\//i.test(p)) return false;
      if (!/\.(jpg|jpeg|png|webp)$/i.test(p)) return false;
      if (/160x160|100x100|\/banners\//i.test(p)) return false;
      return true;
    });
    const contextHistoric = historicProductImgs.filter((u) => matchesPdpContext(u));
    if (contextHistoric.length >= 1) {
      byType.reverse = contextHistoric[0] || null;
      byType.obverse = contextHistoric[1] || contextHistoric[0] || null;
    }
  }
  /**
   * На части commemorative RM отдаёт только "in-acrylic-block"/"case-left" без явных obv/rev.
   * Чтобы не оставлять плейсхолдер, используем box как fallback для сторон.
   */
  if (!byType.obverse && !byType.reverse && byType.box) {
    byType.obverse = byType.box;
    byType.reverse = byType.box;
  }
  // Не сохраняем один и тот же CDN-URL в нескольких ролях: это даёт визуальные дубли в галерее.
  const normImg = (u) => String(u || "").split("?")[0].trim().toLowerCase();
  if (byType.obverse && byType.reverse && normImg(byType.obverse) === normImg(byType.reverse)) {
    byType.obverse = null;
  }
  if (byType.box && byType.reverse && normImg(byType.box) === normImg(byType.reverse)) {
    byType.box = null;
  }
  if (byType.certificate && byType.reverse && normImg(byType.certificate) === normImg(byType.reverse)) {
    byType.certificate = null;
  }
  if (byType.box && byType.obverse && normImg(byType.box) === normImg(byType.obverse)) {
    byType.box = null;
  }
  if (byType.certificate && byType.obverse && normImg(byType.certificate) === normImg(byType.obverse)) {
    byType.certificate = null;
  }
  /** Не дублируем одну сторону в другую: лучше null, чем одинаковые obv/rev. */
  const raw = {
    title: scraped.title,
    specs,
    specificationBlockFound: scraped.specificationBlockFound === true,
    imageUrls: scraped.imageUrls,
    imageUrlsFluidGallery: scraped.imageUrlsFluidGallery || [],
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
    for (const j of jobs) {
      if (j.url) continue;
      coin[j.coinKey] = null;
      const outAbs = path.join(FOREIGN_DIR, j.file);
      if (fs.existsSync(outAbs)) {
        try {
          fs.unlinkSync(outAbs);
          console.log("  ⊗ удалён (нет актуального URL):", j.file);
        } catch (e) {
          console.warn("  ⊗", j.file, e.message);
        }
      }
    }
  } else {
    /** Без скачивания webp — в coin пишем прямые URL CDN (import-royal-mint-to-db и превью). */
    if (byType.obverse) coin.image_obverse = byType.obverse;
    if (byType.reverse) coin.image_reverse = byType.reverse;
    if (byType.blister_obverse) coin.image_blister_obverse = byType.blister_obverse;
    if (byType.blister_reverse) coin.image_blister_reverse = byType.blister_reverse;
    if (byType.box) coin.image_box = byType.box;
    if (byType.certificate) coin.image_certificate = byType.certificate;
    saved.obverse = byType.obverse || null;
    saved.reverse = byType.reverse || null;
    saved.blister_obverse = byType.blister_obverse || null;
    saved.blister_reverse = byType.blister_reverse || null;
    saved.box = byType.box || null;
    saved.certificate = byType.certificate || null;
  }

  const skipDbCollision =
    process.argv.includes("--no-db-spec-collision-check") || process.env.RM_SKIP_DB_SPEC_DUPLICATE_CHECK === "1";
  if (!skipDbCollision) {
    try {
      require("dotenv").config({ path: path.join(__dirname, "..", ".env") });
    } catch {
      /* ignore */
    }
  }
  if (!skipDbCollision && process.env.DATABASE_URL) {
    try {
      const mysql = require("mysql2/promise");
      const url = process.env.DATABASE_URL;
      const m = url.match(/mysql:\/\/([^:]+):([^@]+)@([^:]+):(\d+)\/(.+)/);
      if (m) {
        const [, user, password, host, port, database] = m;
        const conn = await mysql.createConnection({ host, port: parseInt(port, 10), user, password, database });
        const { duplicate_review } = await checkRoyalMintSpecCollisions(conn, coin, specs, { stage: "fetch" });
        await conn.end();
        if (duplicate_review) {
          coin.duplicate_review = duplicate_review;
          console.warn(
            "\n[!] В БД уже есть монета(ы) с теми же год/вес/металл/тираж — см. coin.duplicate_review и data/royal-mint-spec-collision-review.jsonl"
          );
        }
      }
    } catch (e) {
      console.warn("[!] Проверка совпадений с БД не выполнена:", e.message);
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
    console.log(
      "Был --no-images: локальных webp нет; в coin.* прописаны URL CDN Royal Mint (для import в БД и превью)."
    );
  } else {
    console.log("Картинки (если скачались): public/image/coins/foreign/ — пути уже в JSON монеты.");
  }
  console.log("В БД: npm run royal-mint:import → npm run data:export (или data:export:incremental).");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
