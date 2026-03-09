/**
 * Rescrape product-gallery для монет Perth без картинок.
 *
 * Только безопасные случаи:
 *  - coin.source_url содержит perthmint.com
 *  - image_obverse / image_reverse / image_box / image_certificate сейчас ВСЕ null
 *
 * Для каждой такой монеты:
 *  - заходим на coin.source_url через Playwright (stealth);
 *  - в блоке product-gallery собираем реальные URL картинок;
 *  - сохраняем их как webp:
 *      1-я картинка → <slug>-rev.webp  (reverse, главная)
 *      2-я          → <slug>-obv.webp  (obverse)
 *      3-я          → <slug>-box.webp  (box)
 *      4-я          → <slug>-cert.webp (certificate)
 *  - пути записываем в coin.image_* и raw.saved.*
 *
 * Запуск:
 *   node scripts/rescrape-perth-product-gallery.js [--concurrency=4]
 */

const fs = require("fs");
const path = require("path");
const sharp = require("sharp");

const DATA_DIR = path.join(__dirname, "..", "data");
const PUBLIC_DIR = path.join(__dirname, "..", "public");
const FOREIGN_DIR = path.join(PUBLIC_DIR, "image", "coins", "foreign");
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

function loadTargetCoins() {
  const files = fs
    .readdirSync(DATA_DIR)
    .filter((f) => f.startsWith("perth-mint-") && f.endsWith(".json"));

  const targets = [];

  for (const f of files) {
    const full = path.join(DATA_DIR, f);
    let raw;
    try {
      raw = JSON.parse(fs.readFileSync(full, "utf8"));
    } catch {
      continue;
    }
    const coin = raw.coin || {};
    const src = coin.source_url;
    if (!src || !String(src).includes("perthmint.com")) continue;

    const allEmpty =
      !coin.image_obverse &&
      !coin.image_reverse &&
      !coin.image_box &&
      !coin.image_certificate;
    if (!allEmpty) continue;

    targets.push({
      file: f,
      jsonPath: full,
      sourceUrl: String(src),
    });
  }

  return targets;
}

async function scrapeGallery(page, url) {
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
  // Чуть подождём и дадим JS всё дорисовать.
  await page.waitForTimeout(1500);

  const imgs = await page.evaluate(() => {
    const roots = [
      document.querySelector(".product-gallery"),
      document.querySelector("[data-testid='product-gallery']"),
      document.querySelector("[class*='product-gallery']"),
    ].filter(Boolean);
    const root = roots[0] || document;
    const list = Array.from(root.querySelectorAll("img"));
    const urls = list
      .map((img) => img.getAttribute("data-src") || img.getAttribute("src"))
      .filter(Boolean);
    return urls;
  });

  const norm = [];
  for (const u of imgs) {
    if (!u) continue;
    if (isExcludedImage(u)) continue;
    let full = u;
    if (full.startsWith("//")) full = "https:" + full;
    if (full.startsWith("/")) full = "https://www.perthmint.com" + full;
    if (!full.startsWith("http")) continue;
    if (norm.includes(full)) continue;
    norm.push(full);
  }
  return norm;
}

async function processOne(page, target) {
  const { jsonPath, sourceUrl, file } = target;
  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(jsonPath, "utf8"));
  } catch {
    return { status: "error", msg: "parse" };
  }
  const coin = raw.coin || {};

  let urls;
  try {
    urls = await scrapeGallery(page, sourceUrl);
  } catch (e) {
    return { status: "error", msg: "scrape" };
  }

  if (!urls || urls.length === 0) {
    return { status: "skip", msg: "no urls" };
  }

  const slug = slugFromSourceUrl(sourceUrl);

  const picks = {
    reverse: urls[0] || null,
    obverse: urls[1] || null,
    box: urls[2] || null,
    certificate: urls[3] || null,
  };

  const toSave = Object.entries(picks)
    .filter(([, u]) => !!u)
    .map(([role, u]) => {
      const suffix =
        role === "reverse"
          ? "rev"
          : role === "obverse"
          ? "obv"
          : role === "box"
          ? "box"
          : "cert";
      return { role, suffix, url: u };
    });

  if (toSave.length === 0) {
    return { status: "skip", msg: "no picks" };
  }

  const savedPaths = {
    obverse: null,
    reverse: null,
    box: null,
    certificate: null,
  };

  for (const { role, suffix, url } of toSave) {
    const baseName = `${slug}-${suffix}`;
    const webpPath = path.join(FOREIGN_DIR, `${baseName}.webp`);
    const relPath = `/image/coins/foreign/${baseName}.webp`;
    try {
      const ok = await downloadAndSave(url, webpPath);
      if (!ok) continue;
      if (role === "reverse") savedPaths.reverse = relPath;
      else if (role === "obverse") savedPaths.obverse = relPath;
      else if (role === "box") savedPaths.box = relPath;
      else if (role === "certificate") savedPaths.certificate = relPath;
    } catch {
      // пропускаем неудачные загрузки
    }
  }

  if (
    !savedPaths.obverse &&
    !savedPaths.reverse &&
    !savedPaths.box &&
    !savedPaths.certificate
  ) {
    return { status: "skip", msg: "download failed" };
  }

  coin.image_obverse = savedPaths.obverse || null;
  coin.image_reverse = savedPaths.reverse || null;
  coin.image_box = savedPaths.box || null;
  coin.image_certificate = savedPaths.certificate || null;
  raw.coin = coin;

  if (raw.saved && typeof raw.saved === "object") {
    raw.saved.obverse = savedPaths.obverse || null;
    raw.saved.reverse = savedPaths.reverse || null;
    raw.saved.box = savedPaths.box || null;
    raw.saved.certificate = savedPaths.certificate || null;
  }

  fs.writeFileSync(jsonPath, JSON.stringify(raw, null, 2), "utf8");

  const rolesSaved = Object.entries(savedPaths)
    .filter(([, v]) => !!v)
    .map(([k]) => k)
    .join(",");

  return { status: "ok", msg: rolesSaved || "some", file };
}

async function main() {
  const targets = loadTargetCoins();
  if (!targets.length) {
    console.log("Не найдено монет Perth с полностью пустыми image_*.");
    return;
  }

  console.log("Монет Perth с пустыми image_*:", targets.length);

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
  if (concurrency > targets.length) concurrency = targets.length;

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
      if (i >= targets.length) break;
      const t = targets[i];
      const name = path.basename(t.file, ".json").replace("perth-mint-", "");
      try {
        const r = await processOne(page, t);
        if (r.status === "ok") ok++;
        else if (r.status === "skip") skip++;
        else err++;
        console.log(
          `${i + 1}/${targets.length} ${name.slice(0, 60)} — ${r.status} (${r.msg})`
        );
      } catch (e) {
        err++;
        console.log(`${i + 1}/${targets.length} ${name.slice(0, 60)} — error`);
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

