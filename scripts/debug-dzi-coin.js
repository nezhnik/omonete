/**
 * Отладка DZI для одной монеты: сохраняет тайлы, склейку до/после обрезки.
 * Запуск: node scripts/debug-dzi-coin.js 5009-0001
 * Результат: public/image/debug-5009-0001/ — тайлы, stitched_raw.png, stitched_after_crop.webp
 */
const fs = require("fs");
const path = require("path");
const sharp = require("sharp");

const CATALOG_NUM = process.argv[2] || "5009-0001";
const DZI_PAGE = "https://www.cbr.ru/dzi/";
const BASE = "https://www.cbr.ru";
const DEBUG_DIR = path.join(__dirname, "..", "public", "image", `debug-${CATALOG_NUM}`);

const BROWSER_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  Accept: "text/html,application/xhtml+xml,image/webp,image/apng,*/*",
  "Accept-Language": "ru-RU,ru;q=0.9,en;q=0.8",
};

async function fetchBuffer(url) {
  const res = await fetch(url, { redirect: "follow", headers: BROWSER_HEADERS });
  if (!res.ok) return { ok: false };
  return { ok: true, buffer: Buffer.from(await res.arrayBuffer()) };
}

async function fetchText(url) {
  const res = await fetch(url, { redirect: "follow", headers: BROWSER_HEADERS });
  if (!res.ok) return null;
  return res.text();
}

function getContentBbox(inputBuffer, whiteThreshold = 235) {
  return sharp(inputBuffer)
    .flatten({ background: { r: 255, g: 255, b: 255 } })
    .raw()
    .toBuffer({ resolveWithObject: true })
    .then(({ data, info }) => {
      const w = info.width;
      const h = info.height;
      const ch = info.channels;
      let minX = w, minY = h, maxX = 0, maxY = 0;
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const i = (y * w + x) * ch;
          if (data[i] < whiteThreshold || data[i + 1] < whiteThreshold || data[i + 2] < whiteThreshold) {
            if (x < minX) minX = x;
            if (x > maxX) maxX = x;
            if (y < minY) minY = y;
            if (y > maxY) maxY = y;
          }
        }
      }
      if (minX > maxX) return null;
      const left = Math.max(0, minX);
      const top = Math.max(0, minY);
      const width = Math.min(w - left, maxX - minX + 1);
      const height = Math.min(h - top, maxY - minY + 1);
      if (width <= 0 || height <= 0) return null;
      return { left, top, width, height };
    });
}

async function debugSide(side) {
  const cat = String(CATALOG_NUM).trim();
  const tilesources = side === "obverse" ? cat + "r" : cat;
  const outDir = path.join(DEBUG_DIR, side === "obverse" ? "obverse" : "reverse");
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

  console.log("\n---", side.toUpperCase(), "tilesources=" + tilesources, "---");
  const html = await fetchText(`${DZI_PAGE}?tilesources=${tilesources}`);
  if (!html) {
    console.log("  DZI страница не загрузилась");
    return;
  }
  const tileSourcesMatch = html.match(/tileSources:\s*["']([^"']+)["']/);
  if (!tileSourcesMatch) {
    console.log("  tileSources не найден в HTML");
    return;
  }
  const xmlPath = tileSourcesMatch[1];
  const xmlUrl = xmlPath.startsWith("http") ? xmlPath : BASE + (xmlPath.startsWith("/") ? xmlPath : "/" + xmlPath);
  const xmlRes = await fetchBuffer(xmlUrl);
  if (!xmlRes.ok || !xmlRes.buffer?.length) {
    console.log("  XML не загрузился");
    return;
  }
  fs.writeFileSync(path.join(outDir, "dzc_output.xml"), xmlRes.buffer);

  const xmlStr = xmlRes.buffer.toString("utf8");
  const width = parseInt(xmlStr.match(/Width="(\d+)"/)?.[1] || "0", 10);
  const height = parseInt(xmlStr.match(/Height="(\d+)"/)?.[1] || "0", 10);
  const tileSize = parseInt(xmlStr.match(/TileSize="(\d+)"/)?.[1] || "256", 10);
  const overlap = parseInt(xmlStr.match(/Overlap="(\d+)"/)?.[1] || "0", 10);
  const maxLevel = parseInt(xmlStr.match(/MaxLevel="(\d+)"/)?.[1] || "0", 10);
  const formatMatch = xmlStr.match(/Format="([^"]+)"/);
  const ext = formatMatch ? formatMatch[1] : "jpg";
  const xmlDir = xmlPath.replace(/\/[^/]+\.xml$/, "");
  const xmlName = xmlPath.replace(/^.*\/([^/]+)\.xml$/, "$1");
  const filesDir = xmlDir + "/" + xmlName + "_files";
  const filesBaseUrl = BASE + (filesDir.startsWith("/") ? filesDir : "/" + filesDir);
  const step = tileSize - overlap;
  const nx = Math.ceil(width / step);
  const ny = Math.ceil(height / step);
  const level = maxLevel;

  console.log("  XML: size", width, "x", height, "tileSize", tileSize, "overlap", overlap, "level", level);
  console.log("  Тайлов:", nx, "x", ny, "=", nx * ny, "step", step);

  const tiles = [];
  let downloaded = 0;
  const BLACK_MEAN_THRESHOLD = 25;
  const MIN_ENTROPY = 0.8;
  const MIN_STDEV = 6;
  for (let row = 0; row < ny; row++) {
    for (let col = 0; col < nx; col++) {
      const tileUrl = `${filesBaseUrl}/${level}/${col}_${row}.${ext}`;
      const tileRes = await fetchBuffer(tileUrl);
      if (!tileRes.ok || tileRes.buffer.length < 100) continue;
      downloaded++;
      const tilePath = path.join(outDir, `tile_${col}_${row}.${ext}`);
      fs.writeFileSync(tilePath, tileRes.buffer);
      let use = true;
      try {
        const stats = await sharp(tileRes.buffer).stats();
        const mean = (stats.channels[0].mean + stats.channels[1].mean + stats.channels[2].mean) / 3;
        if (mean < BLACK_MEAN_THRESHOLD) {
          const stdev = Math.max(stats.channels[0].stdev || 0, stats.channels[1].stdev || 0, stats.channels[2].stdev || 0);
          const entropy = stats.entropy != null ? stats.entropy : 0;
          if (entropy < MIN_ENTROPY && stdev < MIN_STDEV) use = false;
        }
      } catch (_) {}
      if (use) tiles.push({ buffer: tileRes.buffer, left: col * step, top: row * step, col, row });
    }
  }
  console.log("  Скачано тайлов:", downloaded, "из них для склейки:", tiles.length);

  if (tiles.length === 0 || width <= 0 || height <= 0) return;

  console.log("  Холст (по XML):", width, "x", height, "— чёрные тайлы не комбинируем (остаётся белый фон)");

  const compositeInput = tiles.map((t) => ({ input: t.buffer, left: t.left, top: t.top }));
  const stitchedRaw = await sharp({
    create: {
      width,
      height,
      channels: 4,
      background: { r: 255, g: 255, b: 255, alpha: 1 },
    },
  })
    .composite(compositeInput)
    .flatten({ background: { r: 255, g: 255, b: 255 } })
    .png()
    .toBuffer();

  fs.writeFileSync(path.join(outDir, "stitched_raw.png"), stitchedRaw);
  console.log("  Сохранено: stitched_raw.png", width, "x", height);

  const bbox = await getContentBbox(stitchedRaw);
  if (bbox) {
    console.log("  Bbox контента:", bbox);
    const cropped = await sharp(stitchedRaw)
      .flatten({ background: { r: 255, g: 255, b: 255 } })
      .extract(bbox)
      .webp({ quality: 92 })
      .toBuffer();
    fs.writeFileSync(path.join(outDir, "stitched_after_crop.webp"), cropped);
    console.log("  Сохранено: stitched_after_crop.webp", bbox.width, "x", bbox.height);
  } else {
    console.log("  Bbox не найден (пусто?)");
  }
}

async function run() {
  if (!fs.existsSync(DEBUG_DIR)) fs.mkdirSync(DEBUG_DIR, { recursive: true });
  console.log("Монета:", CATALOG_NUM);
  console.log("Папка:", DEBUG_DIR);

  await debugSide("obverse");
  await debugSide("reverse");

  console.log("\nГотово. Открой папку и посмотри: тайлы tile_*.*, stitched_raw.png, stitched_after_crop.webp");
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
