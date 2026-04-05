/**
 * Парсинг одной карточки Royal Dutch Mint.
 * Сохраняет data/royaldutch-mint-<slug>.json и webp в public/image/coins/foreign/<slug>-<role>.webp.
 *
 * Картинки (качество):
 * - Основной источник — JSON галереи Magento в script[type=text/x-magento-init]: mage/gallery/gallery → data[].
 *   У каждого слайда есть full / img / thumb; берём full || img (порядок массива = порядок слайдов на сайте).
 * - Загрузка: для https://www.royaldutchmint.com/media/catalog/product/… убираем query (?optimize=…),
 *   тогда CDN отдаёт оригинал (часто PNG), а не сжатый JPEG по параметрам — см. DevTools «full» vs клик по картинке.
 * - Запасной вариант: img в .fotorama__stage__frame (как раньше), если JSON не разобрать.
 * - Дедуп по basename пути файла (без query).
 *
 * Роли по слайдам: порядок на royal может быть box→obv→rev или obv→rev→box. Выбор схемы:
 *   data/royaldutch-carousel-layout.json → alt/title у img → эвристика «студийная монета».
 * Итоговые слоты (как в export / БД): obv, rev, pack, box, cert, blister-obv, blister-rev.
 * Колонка image_blister_* НЕ заполняем: см. export — при hasAnyBlister в галерее только блистер, без «голой» монеты.
 * Доп. кадры блистера лежат в image_urls и файлах *-blister-obv/rev.webp.
 *
 * image_urls в БД (и у других минтов):
 * - Swissmint, Scottsdale, Herdenkings: в импорте кладётся полный массив из парсера; export подмешивает его к колонкам с дедупом по URL.
 * - Royal Dutch после этого скрипта: те же пути продублированы в колонках obv/rev/pack/box/cert и в image_urls одним упорядоченным массивом без превью-дублей.
 */
const fs = require("fs");
const path = require("path");
const os = require("os");
const https = require("https");
const { saveBufferAsForeignUnified } = require("./lib/save-foreign-unified-webp.js");
const { getRoleSequence } = require("./lib/royaldutch-carousel-layout.js");

const ROOT = path.join(__dirname, "..");
const DATA_DIR = path.join(ROOT, "data");
const FOREIGN = path.join(ROOT, "public", "image", "coins", "foreign");

/** Совпадает с порядком в export-coins / buildImageUrls: pack = упаковка, box = короб. */
const ROLE_SEQUENCE = ["obv", "rev", "pack", "box", "cert", "blister-obv", "blister-rev"];

function normalizeUrl(raw) {
  const u = new URL(raw);
  u.hash = "";
  u.search = "";
  return `${u.origin}${u.pathname}`.replace(/\/+$/, "");
}

function slugFromUrl(url) {
  const u = new URL(url);
  const seg = u.pathname.split("/").filter(Boolean).pop() || "item";
  return seg.toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
}

function parseSpecPairs(raw) {
  const out = {};
  const lines = String(raw || "")
    .split("\n")
    .map((x) => x.replace(/\s+/g, " ").trim())
    .filter(Boolean);
  for (let i = 0; i + 1 < lines.length; i += 2) {
    const k = lines[i].replace(/:$/, "").trim();
    const v = lines[i + 1];
    if (k && v && !out[k]) out[k] = v;
  }
  return out;
}

function download(url, dst) {
  return new Promise((resolve) => {
    const req = https.get(url, { timeout: 30000, headers: { "user-agent": "Mozilla/5.0" } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        return resolve(download(new URL(res.headers.location, url).toString(), dst));
      }
      if (res.statusCode !== 200) {
        res.resume();
        return resolve(false);
      }
      const ws = fs.createWriteStream(dst);
      res.pipe(ws);
      ws.on("finish", () => ws.close(() => resolve(true)));
      ws.on("error", () => resolve(false));
    });
    req.on("error", () => resolve(false));
    req.on("timeout", () => {
      req.destroy();
      resolve(false);
    });
  });
}

/** Оригинал с CDN: path без query даёт исходный PNG/JPEG, с ?optimize= — уменьшенная выдача. */
function bestRoyalDutchDownloadUrl(raw) {
  try {
    const u = new URL(String(raw || "").trim().split(/\s+/)[0]);
    if (!/royaldutchmint\.com$/i.test(u.hostname)) return String(raw).trim();
    if (!/\/media\/catalog\/product\//i.test(u.pathname)) return u.toString();
    return `${u.origin}${u.pathname}`;
  } catch {
    return String(raw || "").trim();
  }
}

async function downloadToBuffer(url) {
  const fetchUrl = bestRoyalDutchDownloadUrl(url);
  const tmp = path.join(os.tmpdir(), `rdm-buf-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  if (!(await download(fetchUrl, tmp))) return null;
  try {
    return fs.readFileSync(tmp);
  } catch {
    return null;
  } finally {
    try {
      fs.unlinkSync(tmp);
    } catch (_) {}
  }
}

async function parseProduct(page, sourceUrl) {
  await page.goto(sourceUrl, { waitUntil: "domcontentloaded", timeout: 120000 });
  await page.waitForSelector(".fotorama__stage .fotorama__stage__frame img, .fotorama__stage__frame img", {
    state: "attached",
    timeout: 25000,
  }).catch(() => {});
  await page.waitForTimeout(800);
  await page
    .waitForFunction(
      () =>
        document.querySelectorAll(".fotorama__stage .fotorama__stage__frame.fotorama__loaded--full img").length > 0 ||
        document.querySelectorAll(".fotorama__stage .fotorama__stage__frame img").length > 0,
      { timeout: 12000 }
    )
    .catch(() => {});

  const parsed = await page.evaluate(() => {
    const txt = (el) => (el && el.textContent ? el.textContent.replace(/\s+/g, " ").trim() : "");
    const title =
      txt(document.querySelector(".amtheme-product-info h1, .amtheme-product-info .page-title span")) ||
      txt(document.querySelector("h1")) ||
      null;
    const price = txt(document.querySelector(".amtheme-product-info .price, .price-box .price"));

    const desc =
      txt(document.querySelector(".product.attribute.description .value")) ||
      txt(document.querySelector(".product.attribute.description")) ||
      null;

    const table =
      document.querySelector(".additional-attributes-wrapper .table-wrapper table.additional-attributes") ||
      document.querySelector("table.additional-attributes");
    const tableText = txt(table);
    const specsText = tableText || "";
    const specs = {};
    const rows = table ? Array.from(table.querySelectorAll("tr")) : [];
    for (const tr of rows) {
      const k =
        txt(tr.querySelector("th")) ||
        txt(tr.querySelector(".label")) ||
        txt(tr.children && tr.children[0]);
      const v =
        txt(tr.querySelector("td")) ||
        txt(tr.querySelector(".data")) ||
        txt(tr.children && tr.children[1]);
      if (k && v && !specs[k]) specs[k] = v;
    }

    function absUrl(u) {
      if (!u || !String(u).trim()) return null;
      const raw = String(u).trim().split(/\s+/)[0];
      if (/^https?:\/\//i.test(raw)) return raw;
      if (raw.startsWith("//")) return `https:${raw}`;
      if (raw.startsWith("/")) return `${location.origin}${raw}`;
      return null;
    }

    function bestFromImg(img) {
      const srcset = img.getAttribute("srcset");
      let bestUrl = null;
      let bestW = 0;
      if (srcset) {
        for (const part of srcset.split(",")) {
          const bits = part.trim().split(/\s+/);
          const cand = bits[0];
          if (!cand) continue;
          const wPart = bits[1] ? parseInt(String(bits[1]).replace(/[^\d]/g, ""), 10) : 0;
          const w = Number.isFinite(wPart) && wPart > 0 ? wPart : 0;
          if (cand && w >= bestW) {
            bestW = w;
            bestUrl = cand;
          }
        }
      }
      if (!bestUrl) {
        bestUrl = img.getAttribute("data-src") || img.getAttribute("src") || img.currentSrc || img.src || null;
      }
      return absUrl(bestUrl);
    }

    function basenameKey(url) {
      try {
        const u = new URL(url);
        const parts = u.pathname.split("/").filter(Boolean);
        const seg = parts[parts.length - 1] || "";
        return seg.replace(/\.(jpg|jpeg|png|webp|gif)$/i, "").toLowerCase();
      } catch {
        return url;
      }
    }

    /**
     * Разбор массива data из mage/gallery/gallery (скобки с учётом строк JSON).
     */
    function parseGalleryJsonArray(html) {
      const i = html.indexOf('"data"');
      if (i === -1) return null;
      const start = html.indexOf("[", i);
      if (start === -1 || start > i + 40) return null;
      let depth = 0;
      let inStr = false;
      let esc = false;
      let q = "";
      for (let k = start; k < html.length; k++) {
        const ch = html[k];
        if (inStr) {
          if (esc) {
            esc = false;
            continue;
          }
          if (ch === "\\") {
            esc = true;
            continue;
          }
          if (ch === q) {
            inStr = false;
            continue;
          }
          continue;
        }
        if (ch === '"' || ch === "'") {
          inStr = true;
          q = ch;
          continue;
        }
        if (ch === "[") depth++;
        else if (ch === "]") {
          depth--;
          if (depth === 0) {
            try {
              return JSON.parse(html.slice(start, k + 1));
            } catch {
              return null;
            }
          }
        }
      }
      return null;
    }

    function framesFromMagentoGallery() {
      const scripts = document.querySelectorAll('script[type="text/x-magento-init"]');
      for (const sc of scripts) {
        const text = sc.textContent || "";
        const gi = text.indexOf('"mage/gallery/gallery"');
        if (gi === -1) continue;
        const arr = parseGalleryJsonArray(text.slice(gi));
        if (!Array.isArray(arr) || !arr.length) continue;
        const seen = new Set();
        const orderedFrames = [];
        for (const item of arr) {
          const u = item.full || item.img || item.thumb || null;
          const abs = absUrl(u);
          if (!abs || !/royaldutchmint\.com|\/media\//i.test(abs)) continue;
          const k = basenameKey(abs);
          if (!k || seen.has(k)) continue;
          seen.add(k);
          const cap = item.caption ? String(item.caption) : "";
          orderedFrames.push({ url: abs, hint: cap.trim() });
        }
        if (orderedFrames.length) return orderedFrames;
      }
      return null;
    }

    let orderedFrames = framesFromMagentoGallery();

    if (!orderedFrames || !orderedFrames.length) {
      const seen = new Set();
      orderedFrames = [];
      const stageImgs = Array.from(
        document.querySelectorAll(
          ".fotorama__stage .fotorama__stage__frame img.fotorama__img, .fotorama__stage .fotorama__stage__frame img"
        )
      );
      for (const img of stageImgs) {
        const u = bestFromImg(img);
        if (!u || !/royaldutchmint\.com|\/media\//i.test(u)) continue;
        const k = basenameKey(u);
        if (!k || seen.has(k)) continue;
        seen.add(k);
        const alt = img.getAttribute("alt") || "";
        const tit = img.getAttribute("title") || "";
        orderedFrames.push({ url: u, hint: `${alt} ${tit}`.trim() });
      }
    }

    return {
      title,
      price_display: price || null,
      description: desc,
      specsText,
      specs,
      orderedFrames,
    };
  });

  const orderedFrames = parsed.orderedFrames || [];
  const orderedUrls = orderedFrames.map((f) => f.url);

  return {
    source_url: sourceUrl,
    title: parsed.title,
    price_display: parsed.price_display,
    description: parsed.description,
    specs: Object.keys(parsed.specs || {}).length ? parsed.specs : parseSpecPairs(parsed.specsText),
    orderedUrls,
    orderedFrames,
    parsedAt: new Date().toISOString(),
  };
}

async function saveParsed(parsed) {
  const source = normalizeUrl(parsed.source_url);
  const slug = slugFromUrl(source);
  if (fs.existsSync(FOREIGN)) {
    const prefix = `${slug}-`;
    for (const fn of fs.readdirSync(FOREIGN)) {
      if (fn.startsWith(prefix) && /\.webp$/i.test(fn)) {
        try {
          fs.unlinkSync(path.join(FOREIGN, fn));
        } catch (_) {}
      }
    }
  }

  const byRole = {};
  const frames =
    Array.isArray(parsed.orderedFrames) && parsed.orderedFrames.length
      ? parsed.orderedFrames
      : (parsed.orderedUrls || []).map((url) => ({ url, hint: "" }));

  const maxSlots = ROLE_SEQUENCE.length;
  const buffers = [];
  for (let i = 0; i < Math.min(maxSlots, frames.length); i++) {
    buffers.push(await downloadToBuffer(frames[i].url));
  }

  const { layout, roles } = await getRoleSequence(slug, frames, buffers);
  if (process.env.RDM_LAYOUT_LOG === "1") {
    console.error(`[rdm-layout] ${slug} → ${layout}`);
  }

  for (let i = 0; i < Math.min(roles.length, frames.length); i++) {
    const buf = buffers[i];
    if (!buf || !buf.length) continue;
    const role = roles[i];
    try {
      byRole[role] = await saveBufferAsForeignUnified(buf, slug, role);
    } catch (_) {}
  }

  const obv = byRole.obv || null;
  const rev = byRole.rev || null;
  const pack = byRole.pack || null;
  const box = byRole.box || null;
  const cert = byRole.cert || null;
  const blisterObv = byRole["blister-obv"] || null;
  const blisterRev = byRole["blister-rev"] || null;

  const imageUrls = [obv, rev, pack, box, cert, blisterObv, blisterRev].filter(Boolean);

  const out = {
    coin: {
      source_url: source,
      slug,
      title: parsed.title,
      price_display: parsed.price_display,
      description: parsed.description,
      specs: parsed.specs,
      parsedAt: parsed.parsedAt,
      image_obverse: obv,
      image_reverse: rev || obv,
      image_packaging: pack,
      image_box: box,
      image_certificate: cert,
      imageUrls,
    },
  };

  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  const outFile = path.join(DATA_DIR, `royaldutch-mint-${slug}.json`);
  fs.writeFileSync(outFile, JSON.stringify(out, null, 2) + "\n", "utf8");
  return { outFile, imageCount: imageUrls.length, imageUrls, byRole };
}

async function fetchOneWithPage(page, rawUrl) {
  const source = normalizeUrl(rawUrl);
  const parsed = await parseProduct(page, source);
  return saveParsed(parsed);
}

async function main() {
  const rawUrl = process.argv.find((a) => /^https?:\/\//i.test(a));
  if (!rawUrl) {
    console.error('Укажите URL: node scripts/fetch-royaldutch-product.js "https://..."');
    process.exit(1);
  }
  const { chromium } = require("playwright-extra");
  const StealthPlugin = require("puppeteer-extra-plugin-stealth");
  chromium.use(StealthPlugin());
  const browser = await chromium.launch({ headless: process.env.HEADLESS !== "0", args: ["--no-sandbox"] });
  const context = await browser.newContext({
    locale: "en-GB",
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    viewport: { width: 1400, height: 900 },
  });
  const page = await context.newPage();
  const r = await fetchOneWithPage(page, rawUrl);
  await browser.close();
  console.log("Готово:", r.outFile, "Картинок:", r.imageCount);
}

module.exports = { normalizeUrl, slugFromUrl, parseProduct, saveParsed, fetchOneWithPage, ROLE_SEQUENCE };

if (require.main === module) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
