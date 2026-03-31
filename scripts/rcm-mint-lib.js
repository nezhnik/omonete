/**
 * Общие функции для парсера Royal Canadian Mint (mint.ca).
 * Листинг: .js-product-list.products.row — пропускаем .block.containerblock (рекламные вставки).
 */

/** Канонический URL PDP: без query/hash, без хвостового слэша */
function canonicalMintCaProductUrl(raw) {
  if (raw == null || typeof raw !== "string") return null;
  const s = raw.trim();
  if (!s) return null;
  try {
    const u = new URL(s);
    if (!/mint\.ca$/i.test(u.hostname)) return null;
    u.hash = "";
    u.search = "";
    const p = u.pathname.replace(/\/+$/, "") || "";
    return `https://www.mint.ca${p}`;
  } catch {
    return null;
  }
}

/** Нормализация заголовка для сопоставления с БД */
function normalizeTitleForMatch(s) {
  if (s == null || typeof s !== "string") return "";
  return s
    .toLowerCase()
    .replace(/[\u200b\u00a0]/g, " ")
    .replace(/[™®©]/g, "")
    .replace(/\s+/g, " ")
    .replace(/[–—-]/g, " ")
    .replace(/[^\p{L}\p{N}\s./]/gu, "")
    .trim();
}

function levenshteinDistance(a, b) {
  if (a === b) return 0;
  const m = a.length;
  const n = b.length;
  if (!m) return n;
  if (!n) return m;
  const dp = new Array(n + 1);
  for (let j = 0; j <= n; j++) dp[j] = j;
  for (let i = 1; i <= m; i++) {
    let prev = dp[0];
    dp[0] = i;
    for (let j = 1; j <= n; j++) {
      const t = dp[j];
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[j] = Math.min(dp[j] + 1, dp[j - 1] + 1, prev + cost);
      prev = t;
    }
  }
  return dp[n];
}

/**
 * Сходство заголовков 0..1: 1 − расстояние Левенштейна / max длина (после normalizeTitleForMatch).
 * Удобно для порога вроде 0.93 (не менее 93% «похожести»).
 */
function titleSimilarity01(a, b) {
  const na = normalizeTitleForMatch(a);
  const nb = normalizeTitleForMatch(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  const d = levenshteinDistance(na, nb);
  const maxLen = Math.max(na.length, nb.length, 1);
  return 1 - d / maxLen;
}

/** Ссылка на карточку товара (не категория, не сервис) */
function isMintCaProductHref(href) {
  if (!href || typeof href !== "string") return false;
  const lower = href.toLowerCase();
  if (!lower.includes("mint.ca")) return false;
  if (lower.includes("/shop/categories/")) return false;
  if (lower.includes("/cart") || lower.includes("/checkout") || lower.includes("/login")) return false;
  try {
    const u = new URL(href.startsWith("http") ? href : `https://www.mint.ca${href.startsWith("/") ? "" : "/"}${href}`);
    return /\/en\/shop\/coins\//i.test(u.pathname);
  } catch {
    return /\/en\/shop\/coins\//i.test(href);
  }
}

/**
 * Извлечь абсолютные URL товаров с уже открытой страницы листинга.
 * Прямые дочерние элементы .js-product-list.products.row: пропускаем баннеры .block.containerblock.
 */
function listingExtractProductUrlsScript() {
  return () => {
    const origin = window.location.origin || "https://www.mint.ca";
    const toAbs = (h) => {
      if (!h) return null;
      if (h.startsWith("http")) return h.split("#")[0].split("?")[0];
      if (h.startsWith("/")) return origin + h.split("#")[0].split("?")[0];
      return `${origin}/${h}`.split("#")[0].split("?")[0];
    };

    const root = document.querySelector(".js-product-list.products.row");
    if (!root) return { urls: [], debug: "no_list_root" };

    const urls = new Set();
    const isBannerChild = (el) => {
      if (!el || el.nodeType !== 1) return true;
      const cl = typeof el.className === "string" ? el.className : "";
      if (/\bcontainerblock\b/.test(cl) && /\bblock\b/.test(cl)) return true;
      if (/\bcontainerblock\b/.test(cl)) return true;
      return false;
    };

    const considerHref = (h) => {
      const abs = toAbs(h);
      if (!abs) return;
      if (!/\/en\/shop\/coins\//i.test(abs)) return;
      if (/\/shop\/categories\//i.test(abs)) return;
      try {
        const u = new URL(abs);
        u.hash = "";
        u.search = "";
        urls.add(`${u.origin}${u.pathname}`.replace(/\/+$/, ""));
      } catch {
        /* skip */
      }
    };

    for (const child of root.children) {
      if (isBannerChild(child)) continue;
      child.querySelectorAll("a[href]").forEach((a) => considerHref(a.getAttribute("href")));
    }

    return { urls: Array.from(urls), debug: "ok" };
  };
}

/**
 * Извлечь пути PDP из сырого HTML листинга (SEO-разметка содержит все карточки до текущей страницы).
 * Паттерн: /en/shop/coins/ГОД/slug (без query).
 */
function extractMintCaCoinPathsFromListingHtml(html) {
  if (html == null || typeof html !== "string") return [];
  const re = /\/en\/shop\/coins\/\d{4}\/[^"'<>\s?]+/g;
  const out = new Set();
  let m;
  while ((m = re.exec(html)) !== null) {
    let p = m[0];
    if (p.includes("/shop/categories/")) continue;
    const q = p.indexOf("?");
    if (q >= 0) p = p.slice(0, q);
    out.add(p.replace(/\/+$/, ""));
  }
  return Array.from(out);
}

module.exports = {
  canonicalMintCaProductUrl,
  normalizeTitleForMatch,
  titleSimilarity01,
  isMintCaProductHref,
  listingExtractProductUrlsScript,
  extractMintCaCoinPathsFromListingHtml,
};
