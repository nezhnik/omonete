/**
 * Пересобирает картинки Perth строго по порядку raw.imageUrls.
 *
 * Идея ровно как ты описал:
 *  1-й URL — качаем картинку, ставим как reverse (главная),
 *  2-й URL — качаем, ставим как obverse,
 *  3-й URL — коробка (box),
 *  4-й URL — сертификат (certificate).
 *
 * Ограничения для безопасности:
 *  - только монеты Perth (coin.source_url содержит perthmint.com);
 *  - только там, где сейчас ВСЕ image_obverse/reverse/box/certificate == null
 *    (в том числе наши очищенные 120 монет);
 *  - используем только URL из raw.imageUrls (то, что уже когда-то сняли
 *    с product-gallery на сайте Perth).
 *
 * Запуск:
 *   node scripts/rebuild-perth-images-from-raw-gallery.js
 */

const fs = require("fs");
const path = require("path");
const sharp = require("sharp");

const DATA_DIR = path.join(__dirname, "..", "data");
const PUBLIC_DIR = path.join(__dirname, "..", "public");
const FOREIGN_DIR = path.join(PUBLIC_DIR, "image", "coins", "foreign");
const BASE_URL = "https://www.perthmint.com";
const MAX_SIDE = 1200;

function slugFromSourceUrl(url) {
  const pathname = String(url).replace(/^https?:\/\/[^/]+/, "").replace(/\?.*$/, "").replace(/\/$/, "");
  const segments = pathname.split("/").filter(Boolean);
  const last = segments[segments.length - 1] || "perth-coin";
  return last
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "") || "perth-coin";
}

function isExcludedImage(url) {
  const pathPart = String(url).split("?")[0].toLowerCase();
  return /on-edge|onedge|\bleft\b|left\.|left\-/.test(pathPart);
}

async function downloadAndSave(imgUrl, destPath) {
  const url = imgUrl.startsWith("http") ? imgUrl : BASE_URL + imgUrl;
  const fullUrl = url.replace(/width=\d+/gi, "width=2000");
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

async function processOne(jsonPath) {
  const name = path.basename(jsonPath);
  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(jsonPath, "utf8"));
  } catch {
    return { status: "error", msg: "parse" };
  }
  const coin = raw.coin || {};
  const sourceUrl = coin.source_url;
  if (!sourceUrl || !sourceUrl.includes("perthmint.com")) {
    return { status: "skip", msg: "not perth" };
  }

  const allEmpty =
    !coin.image_obverse &&
    !coin.image_reverse &&
    !coin.image_box &&
    !coin.image_certificate;
  if (!allEmpty) {
    return { status: "skip", msg: "has images" };
  }

  const urls = raw?.raw?.imageUrls;
  if (!Array.isArray(urls) || urls.length === 0) {
    return { status: "skip", msg: "no raw.imageUrls" };
  }

  // Берём только "товарные" картинки и убираем очевидные edge/left.
  const gallery = urls
    .filter((u) => u && (u.includes("/coins/") || u.includes("product")))
    .filter((u) => !isExcludedImage(u));

  if (gallery.length === 0) {
    return { status: "skip", msg: "no gallery" };
  }

  const slug = slugFromSourceUrl(sourceUrl);

  const picks = {
    reverse: gallery[0] || null,
    obverse: gallery[1] || null,
    box: gallery[2] || null,
    certificate: gallery[3] || null,
  };

  const toSave = Object.entries(picks)
    .filter(([, url]) => !!url)
    .map(([role, url]) => {
      const suffix =
        role === "reverse"
          ? "rev"
          : role === "obverse"
          ? "obv"
          : role === "box"
          ? "box"
          : "cert";
      return { role, suffix, url };
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
    const ok = await downloadAndSave(url, webpPath);
    if (!ok) continue;
    if (role === "reverse") savedPaths.reverse = relPath;
    else if (role === "obverse") savedPaths.obverse = relPath;
    else if (role === "box") savedPaths.box = relPath;
    else if (role === "certificate") savedPaths.certificate = relPath;
  }

  if (!savedPaths.obverse && !savedPaths.reverse && !savedPaths.box && !savedPaths.certificate) {
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

  return { status: "ok", msg: rolesSaved || "some" };
}

async function main() {
  const files = fs
    .readdirSync(DATA_DIR)
    .filter((f) => f.startsWith("perth-mint-") && f.endsWith(".json"))
    .map((f) => path.join(DATA_DIR, f));

  console.log("Каноники Perth:", files.length);

  let ok = 0;
  let skip = 0;
  let err = 0;

  for (let i = 0; i < files.length; i++) {
    const f = files[i];
    const name = path.basename(f, ".json").replace("perth-mint-", "");
    // eslint-disable-next-line no-await-in-loop
    const r = await processOne(f);
    if (r.status === "ok") ok++;
    else if (r.status === "skip") skip++;
    else err++;

    if ((i + 1) % 30 === 0 || r.status !== "ok") {
      console.log(`${i + 1}/${files.length} ${name.slice(0, 60)} — ${r.status} (${r.msg})`);
    }

    // чуть замедлим, чтобы не долбить Perth слишком агрессивно
    // eslint-disable-next-line no-await-in-loop
    await new Promise((res) => setTimeout(res, 150));
  }

  console.log("\nГотово. ok:", ok, "| skip:", skip, "| error:", err);
  console.log("Дальше: node scripts/update-perth-from-canonical-json.js → export → build");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

