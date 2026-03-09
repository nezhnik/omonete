/**
 * Перекачивает и чинит реверсы для серии Chinese Myths and Legends.
 *
 * Идея:
 *  - Берём все каноники, начинающиеся с perth-mint-chinese-myths-*.json.
 *  - Из raw.imageUrls пытаемся выбрать правильную картинку реверса
 *    (reverse / straight-on, coloured дизайн, а не портрет).
 *  - Качаем в /public/image/coins/foreign/<slug>-rev.webp
 *    и обновляем coin.image_reverse, coin.imageUrl и saved.reverse.
 *
 * Безопасность:
 *  - Меняем только реверс (и главную картинку imageUrl).
 *  - obverse / box / certificate не трогаем.
 *
 * Запуск:
 *   node scripts/fix-chinese-myths-reverse-images.js
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
  const pathname = String(url)
    .replace(/^https?:\/\/[^/]+/, "")
    .replace(/\?.*$/, "")
    .replace(/\/$/, "");
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

function pickReverseUrl(urls) {
  if (!Array.isArray(urls) || !urls.length) return null;
  const list = urls.map(String).filter(Boolean);

  const scored = list.map((u) => {
    const lower = u.toLowerCase();
    let score = 0;

    if (lower.includes("reverse-in-card-front")) score += 50;
    if (lower.includes("straight-on") || lower.includes("straighton")) score += 40;
    if (lower.includes("reverse")) score += 30;
    if (lower.includes("coloured-coin")) score += 20;

    if (lower.includes("obverse")) score -= 100;
    if (lower.includes("obverse-in-card-back")) score -= 80;
    if (lower.includes("card-back")) score -= 20;

    return { url: u, score };
  });

  scored.sort((a, b) => b.score - a.score);
  const best = scored[0];
  if (!best || best.score < 0) {
    return list[0];
  }
  return best.url;
}

async function processOne(fileName) {
  const jsonPath = path.join(DATA_DIR, fileName);
  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(jsonPath, "utf8"));
  } catch {
    return { status: "error", msg: "parse" };
  }

  const coin = raw.coin || {};
  const sourceUrl = coin.source_url;
  const urls = raw?.raw?.imageUrls;
  if (!sourceUrl || !Array.isArray(urls) || urls.length === 0) {
    return { status: "skip", msg: "no source_url or imageUrls" };
  }

  const reverseUrl = pickReverseUrl(urls);
  if (!reverseUrl) {
    return { status: "skip", msg: "no reverse candidate" };
  }

  const slug = slugFromSourceUrl(sourceUrl);
  const baseName = `${slug}-rev`;
  const destPath = path.join(FOREIGN_DIR, `${baseName}.webp`);
  const relPath = `/image/coins/foreign/${baseName}.webp`;

  const ok = await downloadAndSave(reverseUrl, destPath);
  if (!ok) {
    return { status: "skip", msg: "download failed" };
  }

  coin.image_reverse = relPath;
  coin.imageUrl = relPath;
  raw.coin = coin;

  if (raw.saved && typeof raw.saved === "object") {
    raw.saved.reverse = relPath;
  }

  fs.writeFileSync(jsonPath, JSON.stringify(raw, null, 2), "utf8");

  return { status: "ok", msg: reverseUrl };
}

async function main() {
  const files = fs
    .readdirSync(DATA_DIR)
    .filter(
      (f) =>
        f.startsWith("perth-mint-chinese-myths") &&
        f.endsWith(".json")
    );

  console.log("Chinese Myths and Legends каноников:", files.length);

  let ok = 0;
  let skip = 0;
  let err = 0;

  for (let i = 0; i < files.length; i++) {
    const f = files[i];
    const name = f.replace(/^perth-mint-/, "").replace(/\.json$/, "");
    try {
      // eslint-disable-next-line no-await-in-loop
      const r = await processOne(f);
      if (r.status === "ok") ok++;
      else if (r.status === "skip") skip++;
      else err++;
      console.log(`${i + 1}/${files.length} ${name} — ${r.status} (${r.msg})`);
    } catch (e) {
      err++;
      console.log(`${i + 1}/${files.length} ${name} — error`);
    }
    // чуть замедлим запросы к Perth
    // eslint-disable-next-line no-await-in-loop
    await new Promise((res) => setTimeout(res, 250));
  }

  console.log("\nГотово. ok:", ok, "| skip:", skip, "| error:", err);
  console.log(
    "Дальше: node scripts/update-perth-from-canonical-json.js → export → build"
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

