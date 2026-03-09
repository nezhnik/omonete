/**
 * Rescrape product-gallery ТОЛЬКО для 120 проблемных Perth-монет
 * из data/perth-image-foreign-slug-original.txt.
 *
 * Для каждого файла из списка:
 *  - читаем coin.source_url;
 *  - через Playwright заходим на страницу Perth;
 *  - в блоке product-gallery собираем реальные URL картинок;
 *  - в порядке:
 *      1-я картинка → reverse
 *      2-я          → obverse
 *      3-я          → box
 *      4-я          → certificate
 *    заполняем ТОЛЬКО те роли, где сейчас coin.image_* == null;
 *    существующие пути (если ты что-то уже правил руками) не трогаем.
 *
 * Картинки скачиваются в webp под именами:
 *   <slug>-rev.webp / <slug>-obv.webp / <slug>-box.webp / <slug>-cert.webp
 * в public/image/coins/foreign и пути прописываются в JSON (coin.* и raw.saved.*).
 *
 * Запуск:
 *   node scripts/rescrape-perth-product-gallery-foreign-slug.js --concurrency=3
 */

const fs = require("fs");
const path = require("path");
const sharp = require("sharp");

const DATA_DIR = path.join(__dirname, "..", "data");
const PUBLIC_DIR = path.join(__dirname, "..", "public");
const FOREIGN_DIR = path.join(PUBLIC_DIR, "image", "coins", "foreign");
const ORIGINAL_LIST = path.join(DATA_DIR, "perth-image-foreign-slug-original.txt");
const MAX_SIDE = 1200;

function slugFromSourceUrl(url) {
  const pathname = String(url).replace(/^https?:\/\/[^/]+/, "").replace(/\?.*$/, "").replace(/\/$/, "");
  const segments = pathname.split("/").filter(Boolean);
  const last = segments[segments.length - 1] || "perth-coin";
  return (
    last
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "") || "perth-coin"
  );
}

function isExcludedImage(url) {
  const u = String(url).toLowerCase();
  return (
    u.includes("placeholder") ||
    u.includes("no-image") ||
    /on-edge|onedge|\bleft\b|left\.|left\-/.test(u)
  );
}

function parseOriginalList() {
  if (!fs.existsSync(ORIGINAL_LIST)) {
    throw new Error(`Не найден файл списка: ${ORIGINAL_LIST}`);
  }
  const text = fs.readFileSync(ORIGINAL_LIST, "utf8");
  const lines = text
    .split(/\r?\n/g)
    .map((s) => s.trim())
    .filter(Boolean);

  const files = new Set();
  for (const line of lines) {
    const part = line.split(" | ").find((p) => p.startsWith("file="));
    if (!part) continue;
    const file = part.slice("file=".length);
    if (file) files.add(file);
  }
  return Array.from(files);
}

async function downloadAndSave(fullUrl, destPath) {
  const res = await fetch(fullUrl, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0 Safari/537.36",
    },
    redirect: "follow",
  });
  if (!res.ok) return false;
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length < 1000) return false;
  await sharp(buf)
    .resize(MAX_SIDE, MAX_SIDE, { fit: "inside", withoutEnlargement: true })
    .webp({ quality: 82, effort: 6, smartSubsample: true })
    .toFile(destPath);
  return true;
}

async function scrapeGallery(page, url) {
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForTimeout(1500);

  const imgs = await page.evaluate(() => {
    const roots = [
      document.querySelector(".product-gallery"),
      document.querySelector("[data-testid='product-gallery']"),
      document.querySelector("[class*='product-gallery']"),
    ].filter(Boolean);
    const root = roots[0] || document;
    const list = Array.from(root.querySelectorAll("img"));
    return list
      .map((img) => img.getAttribute("data-src") || img.getAttribute("src"))
      .filter(Boolean);
  });

  const urls = [];
  for (const u of imgs) {
    if (!u) continue;
    if (isExcludedImage(u)) continue;
    let full = u;
    if (full.startsWith("//")) full = "https:" + full;
    if (full.startsWith("/")) full = "https://www.perthmint.com" + full;
    if (!full.startsWith("http")) continue;
    if (urls.includes(full)) continue;
    urls.push(full);
  }
  return urls;
}

async function processOne(page, fileName) {
  const jsonPath = path.join(DATA_DIR, fileName);
  if (!fs.existsSync(jsonPath)) {
    return { status: "skip", msg: "no json" };
  }

  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(jsonPath, "utf8"));
  } catch {
    return { status: "error", msg: "parse" };
  }
  const coin = raw.coin || {};
  const sourceUrl = coin.source_url;
  if (!sourceUrl || !String(sourceUrl).includes("perthmint.com")) {
    return { status: "skip", msg: "no perth source_url" };
  }

  let urls;
  try {
    urls = await scrapeGallery(page, sourceUrl);
  } catch {
    return { status: "error", msg: "scrape" };
  }

  if (!urls || urls.length === 0) {
    return { status: "skip", msg: "no gallery urls" };
  }

  const slug = slugFromSourceUrl(sourceUrl);
  const order = ["reverse", "obverse", "box", "certificate"];

  const picks = {};
  for (let i = 0; i < order.length; i++) {
    picks[order[i]] = urls[i] || null;
  }

  const keyByRole = {
    reverse: "image_reverse",
    obverse: "image_obverse",
    box: "image_box",
    certificate: "image_certificate",
  };

  const suffixByRole = {
    reverse: "rev",
    obverse: "obv",
    box: "box",
    certificate: "cert",
  };

  const savedPaths = {
    obverse: coin.image_obverse || null,
    reverse: coin.image_reverse || null,
    box: coin.image_box || null,
    certificate: coin.image_certificate || null,
  };

  let changed = 0;

  for (const role of order) {
    const imgUrl = picks[role];
    const key = keyByRole[role];
    const suffix = suffixByRole[role];
    if (!imgUrl || !key || !suffix) continue;
    // Заполняем только там, где сейчас null
    if (coin[key] != null) continue;

    const baseName = `${slug}-${suffix}`;
    const webpPath = path.join(FOREIGN_DIR, `${baseName}.webp`);
    const relPath = `/image/coins/foreign/${baseName}.webp`;
    try {
      const ok = await downloadAndSave(imgUrl, webpPath);
      if (!ok) continue;
      coin[key] = relPath;
      if (role === "reverse") savedPaths.reverse = relPath;
      else if (role === "obverse") savedPaths.obverse = relPath;
      else if (role === "box") savedPaths.box = relPath;
      else if (role === "certificate") savedPaths.certificate = relPath;
      changed++;
    } catch {
      // просто пропускаем неудачный даунлоад
    }
  }

  raw.coin = coin;
  if (raw.saved && typeof raw.saved === "object") {
    raw.saved.obverse = savedPaths.obverse || null;
    raw.saved.reverse = savedPaths.reverse || null;
    raw.saved.box = savedPaths.box || null;
    raw.saved.certificate = savedPaths.certificate || null;
  }

  if (changed > 0) {
    fs.writeFileSync(jsonPath, JSON.stringify(raw, null, 2), "utf8");
    const roles = Object.entries(savedPaths)
      .filter(([, v]) => !!v)
      .map(([k]) => k)
      .join(",");
    return { status: "ok", msg: `${changed} roles (${roles})` };
  }

  return { status: "skip", msg: "nothing filled" };
}

async function main() {
  const files = parseOriginalList();
  console.log("Файлов из списка foreign-slug:", files.length);

  let chromium;
  try {
    const playwrightExtra = require("playwright-extra");
    chromium = playwrightExtra.chromium;
    chromium.use(require("puppeteer-extra-plugin-stealth")());
  } catch (e) {
    console.error("Нужны зависимости: playwright-extra, puppeteer-extra-plugin-stealth");
    process.exit(1);
  }

  const concurrencyArg = process.argv.find((a) => a.startsWith("--concurrency="));
  let concurrency = concurrencyArg ? parseInt(concurrencyArg.split("=")[1], 10) || 2 : 2;
  if (concurrency < 1) concurrency = 1;
  if (concurrency > 6) concurrency = 6;
  if (concurrency > files.length) concurrency = files.length;

  const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
  const pages = [];
  for (let i = 0; i < concurrency; i++) {
    const page = await browser.newPage();
    page.setDefaultTimeout(30000);
    pages.push(page);
  }

  let idx = 0;
  let ok = 0;
  let skip = 0;
  let err = 0;

  async function worker(page) {
    while (true) {
      const i = idx++;
      if (i >= files.length) break;
      const f = files[i];
      const name = f.replace(/^perth-mint-/, "").replace(/\.json$/, "");
      try {
        const r = await processOne(page, f);
        if (r.status === "ok") ok++;
        else if (r.status === "skip") skip++;
        else err++;
        console.log(`${i + 1}/${files.length} ${name.slice(0, 60)} — ${r.status} (${r.msg})`);
      } catch (e) {
        err++;
        console.log(`${i + 1}/${files.length} ${name.slice(0, 60)} — error`);
      }
      await new Promise((res) => setTimeout(res, 500));
    }
  }

  await Promise.all(pages.map((p) => worker(p)));
  await Promise.all(pages.map((p) => p.close()));
  await browser.close();

  console.log("\nГотово. ok:", ok, "| skip:", skip, "| error:", err);
  console.log("Дальше: node scripts/update-perth-from-canonical-json.js → export → build");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

