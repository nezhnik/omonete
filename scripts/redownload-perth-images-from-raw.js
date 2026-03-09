/**
 * Перекачивает картинки Perth из raw.imageUrls в канониках.
 * Не открывает страницы Perth — берёт URL из наших JSON.
 * БЕЗ fallback: только картинки этого продукта (по SKU/папке). Без кеша — fetch каждый раз.
 *
 * Фильтрация: 1) SKU из спеок (Product Code) — путь должен содержать эту папку;
 * 2) или папка = самая частая в первых 15 URL (галерея товара идёт первой, "you may also like" — после).
 * Если после фильтра 0 URL — пропуск (не берём чужие картинки).
 *
 * Запуск: node scripts/redownload-perth-images-from-raw.js [--dry]
 *   --only-missing — только монеты без картинок или с отсутствующими файлами
 */
const fs = require("fs");
const path = require("path");
const sharp = require("sharp");

const DATA_DIR = path.join(__dirname, "..", "data");
const FOREIGN_DIR = path.join(__dirname, "..", "public", "image", "coins", "foreign");
const BASE_URL = "https://www.perthmint.com";
const MAX_SIDE = 1200;
const GALLERY_HEAD_COUNT = 15; // галерея товара в начале; "you may also like" — дальше

function extractFolder(imgUrl) {
  const str = String(imgUrl);
  const m = str.match(/\/coins\/(?:01\.-archive\/)?(?:20\d{2}|19\d{2}|2012-2020)\/([a-z0-9]+)\//i);
  return m ? m[1].toLowerCase() : null;
}

/** SKU из спеок (Product Code, SKU) — для строгой фильтрации. */
function getProductSku(coin, raw) {
  const sku = (raw?.specs?.["SKU"] || raw?.specs?.["Product Code"] || coin?.catalog_suffix || "")
    .toString()
    .toLowerCase()
    .replace(/\s/g, "");
  return sku || null;
}

function isExcludedImage(url) {
  const pathPart = String(url).split("?")[0].toLowerCase();
  return /on-edge|onedge|\bleft\b|left\.|left\-/.test(pathPart);
}

function imageType(url) {
  if (isExcludedImage(url)) return null;
  const lower = String(url).toLowerCase();
  const pathPart = lower.split("?")[0];
  if (/obverse|obv\.|obv-|\-obv\.|\-03\-/.test(pathPart)) return "obverse";
  if (/rev\.|\-rev\.|reverse|straight\-on|straight\.|\-01\-|\-02\-|straighton/.test(pathPart) && !/obverse/.test(pathPart)) return "reverse";
  if (/\-outer\-|outer-left|packaging|danger|pack\./.test(pathPart)) return "certificate";
  if (/box|box-front|\-04\-|in-case|in-capsule|incase/.test(pathPart)) return "box";
  if (/certificate|cert\.|\-cert\.|in-shipper|inshipper/.test(pathPart)) return "certificate";
  return null;
}

function slugFromSourceUrl(url) {
  const pathname = String(url).replace(/^https?:\/\/[^/]+/, "").replace(/\?.*$/, "").replace(/\/$/, "");
  const segments = pathname.split("/").filter(Boolean);
  const last = segments[segments.length - 1] || "perth-coin";
  return last.toLowerCase().replace(/[^a-z0-9-]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "") || "perth-coin";
}

async function downloadAndSave(imgUrl, destPath) {
  const url = imgUrl.startsWith("http") ? imgUrl : BASE_URL + imgUrl;
  const fullUrl = url.replace(/width=\d+/gi, "width=2000");
  const res = await fetch(fullUrl, {
    headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0 Safari/537.36" },
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

async function processOne(filePath) {
  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (e) {
    return { status: "error", msg: "parse" };
  }
  const coin = raw?.coin;
  const urls = raw?.raw?.imageUrls;
  if (!coin || !Array.isArray(urls) || urls.length === 0) return { status: "skip", msg: "no urls" };

  const sourceUrl = coin.source_url;
  if (!sourceUrl || !sourceUrl.includes("perthmint.com")) return { status: "skip", msg: "no source_url" };

  const fileSlug = slugFromSourceUrl(sourceUrl);
  const productSku = getProductSku(coin, raw?.raw);

  const coinUrls = urls.filter((u) => u && (u.includes("/coins/") || u.includes("product")));
  if (coinUrls.length === 0) return { status: "skip", msg: "no image urls" };

  // Папка продукта = самая частая в первых 15 (галерея; "you may also like" — дальше)
  const headUrls = coinUrls.slice(0, GALLERY_HEAD_COUNT);
  const folderCounts = {};
  headUrls.forEach((u) => {
    const f = extractFolder(u);
    if (f) folderCounts[f] = (folderCounts[f] || 0) + 1;
  });
  const best = Object.entries(folderCounts).sort((a, b) => b[1] - a[1])[0];
  const productFolder = best ? best[0] : null;

  // Строго: только URL этого продукта (папка в пути). Без fallback на "все картинки".
  let byProduct = productFolder ? coinUrls.filter((u) => extractFolder(u) === productFolder) : [];
  if (byProduct.length === 0 && productSku) {
    byProduct = coinUrls.filter((u) => String(u).toLowerCase().includes("/" + productSku + "/"));
  }
  if (byProduct.length === 0) return { status: "skip", msg: "no matching product images" };

  const excluded = byProduct.filter((u) => !isExcludedImage(u));

  const byType = { obverse: null, reverse: null, box: null, certificate: null };
  for (const typ of ["reverse", "obverse", "box", "certificate"]) {
    const found = excluded.find((u) => imageType(u) === typ);
    if (found) byType[typ] = found;
  }
  if (!byType.reverse && excluded.length > 0) byType.reverse = excluded.find((u) => /rev|reverse|02-|straight/.test(String(u).toLowerCase())) || excluded[0];
  if (!byType.obverse && excluded.length > 0) byType.obverse = excluded.find((u) => /obv|obverse|01-|03-/.test(String(u).toLowerCase()) && u !== byType.reverse) || excluded.find((u) => u !== byType.reverse);
  if (byType.obverse === byType.reverse) byType.obverse = null;

  const PUBLIC_DIR = path.join(__dirname, "..", "public");
  const resolvePath = (rel) => (rel ? path.join(PUBLIC_DIR, rel.replace(/^\//, "")) : null);
  const onlyMissing = process.argv.includes("--only-missing");

  const toSave = [
    { url: byType.reverse, suffix: "rev", key: "image_reverse" },
    { url: byType.obverse, suffix: "obv", key: "image_obverse" },
    { url: byType.box, suffix: "box", key: "image_box" },
    { url: byType.certificate, suffix: "cert", key: "image_certificate" },
  ].filter((x) => x.url);

  if (onlyMissing) {
    const hasAll = toSave.every(({ key }) => {
      const p = coin[key];
      return p && fs.existsSync(resolvePath(p));
    });
    if (hasAll) return { status: "skip", msg: "all images ok" };
  }

  const saved = { obverse: coin.image_obverse, reverse: coin.image_reverse, box: coin.image_box, certificate: coin.image_certificate };
  for (const { url: imgUrl, suffix, key } of toSave) {
    const baseName = `${fileSlug}-${suffix}`;
    const webpPath = path.join(FOREIGN_DIR, `${baseName}.webp`);
    const relPath = "/image/coins/foreign/" + baseName + ".webp";
    if (onlyMissing && coin[key] && fs.existsSync(resolvePath(coin[key]))) continue;
    const ok = await downloadAndSave(imgUrl, webpPath);
    if (ok) {
      if (suffix === "obv") saved.obverse = relPath;
      else if (suffix === "rev") saved.reverse = relPath;
      else if (suffix === "box") saved.box = relPath;
      else if (suffix === "cert") saved.certificate = relPath;
    }
  }

  coin.image_obverse = saved.obverse || null;
  coin.image_reverse = saved.reverse || null;
  coin.image_box = saved.box || null;
  coin.image_certificate = saved.certificate || null;
  if (raw.saved) {
    raw.saved.obverse = saved.obverse;
    raw.saved.reverse = saved.reverse;
    raw.saved.box = saved.box;
    raw.saved.certificate = saved.certificate;
  }

  if (!process.env.DRY) {
    fs.writeFileSync(filePath, JSON.stringify(raw, null, 2), "utf8");
  }

  const hasMain = !!(saved.obverse || saved.reverse);
  return { status: hasMain ? "ok" : "partial", productFolder, saved: Object.keys(saved).filter((k) => saved[k]).length };
}

async function main() {
  const dry = process.argv.includes("--dry");
  if (dry) {
    console.log("Режим --dry: изменения не сохраняются.\n");
    process.env.DRY = "1";
  }

  const files = fs.readdirSync(DATA_DIR)
    .filter((f) => f.startsWith("perth-mint-") && f.endsWith(".json"))
    .map((f) => path.join(DATA_DIR, f));

  console.log("Каноников Perth:", files.length);

  let ok = 0, partial = 0, skip = 0, err = 0;
  for (let i = 0; i < files.length; i++) {
    const f = files[i];
    const name = path.basename(f, ".json").replace("perth-mint-", "");
    const r = await processOne(f);
    if (r.status === "ok") ok++;
    else if (r.status === "partial") partial++;
    else if (r.status === "skip") skip++;
    else err++;

    if ((i + 1) % 50 === 0 || r.status !== "ok") {
      console.log(`${i + 1}/${files.length} ${name.slice(0, 50)} — ${r.status}`);
    }
    await new Promise((r) => setTimeout(r, 150));
  }

  console.log("\nГотово. ok:", ok, "| partial:", partial, "| skip:", skip, "| error:", err);
  if (!dry) console.log("Дальше: node scripts/update-perth-from-canonical-json.js → export → build");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
