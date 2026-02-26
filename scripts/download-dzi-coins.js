/**
 * Скачивает изображения монет в высоком качестве (DZI → склейка → WebP q=92) в public/image/coins/
 * и обновляет в БД image_obverse, image_reverse. Только монеты с такими картинками потом показываются на сайте.
 *
 * Пример 50 монет:  node scripts/download-dzi-coins.js
 * 180 монет:        node scripts/download-dzi-coins.js 180
 * Все монеты:       node scripts/download-dzi-coins.js --all
 *
 * Запуск из корня omonete-app. Нужен .env с DATABASE_URL.
 */
require("dotenv").config({ path: ".env" });
const mysql = require("mysql2/promise");
const fs = require("fs");
const path = require("path");
const sharp = require("sharp");

const DZI_PAGE = "https://www.cbr.ru/dzi/";
const BASE = "https://www.cbr.ru";
const LEGACY_IMG_BASE = BASE + "/legacy/PhotoStore/img";
const OUT_DIR = path.join(__dirname, "..", "public", "image", "coins");
const limitArg = process.argv.find((a) => /^\d+$/.test(a));
const LIMIT = process.argv.includes("--all") ? 10000 : (limitArg ? parseInt(limitArg, 10) : 50);

const BROWSER_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  Accept: "text/html,application/xhtml+xml,image/webp,image/apng,*/*",
  "Accept-Language": "ru-RU,ru;q=0.9,en;q=0.8",
  Referer: "https://www.cbr.ru/",
};

const WHITE_THRESHOLD = 235;

/** Bounding box контента (пиксели не белые). */
async function getContentBbox(inputBuffer) {
  const { data, info } = await sharp(inputBuffer)
    .flatten({ background: { r: 255, g: 255, b: 255 } })
    .raw()
    .toBuffer({ resolveWithObject: true });
  const w = info.width;
  const h = info.height;
  const ch = info.channels;
  let minX = w, minY = h, maxX = 0, maxY = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * ch;
      if (data[i] < WHITE_THRESHOLD || data[i + 1] < WHITE_THRESHOLD || data[i + 2] < WHITE_THRESHOLD) {
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
}

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

/**
 * Скачать одну сторону монеты по DZI (tilesources = cat для реверса, cat+r для аверса).
 * На ЦБ: без r = реверс, с r = аверс. Возвращает WebP buffer или null.
 */
async function fetchDziAsWebp(catalogNumber, side) {
  const cat = String(catalogNumber).trim();
  const tilesources = side === "obverse" ? cat + "r" : cat;
  const html = await fetchText(`${DZI_PAGE}?tilesources=${tilesources}`);
  if (!html) return null;
  const tileSourcesMatch = html.match(/tileSources:\s*["']([^"']+)["']/);
  if (!tileSourcesMatch) return null;
  const xmlPath = tileSourcesMatch[1].trim();
  const xmlUrl = xmlPath.startsWith("http") ? xmlPath : BASE + (xmlPath.startsWith("/") ? xmlPath : "/" + xmlPath);
  const xmlRes = await fetchBuffer(xmlUrl);
  if (!xmlRes.ok || !xmlRes.buffer?.length) return null;
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
  const tiles = [];
  const BLACK_MEAN_THRESHOLD = 25;
  const MIN_ENTROPY = 0.8;
  const MIN_STDEV = 6;
  for (let row = 0; row < ny; row++) {
    for (let col = 0; col < nx; col++) {
      const tileRes = await fetchBuffer(`${filesBaseUrl}/${level}/${col}_${row}.${ext}`);
      if (!tileRes.ok || tileRes.buffer.length < 100) continue;
      let use = true;
      try {
        const meta = await sharp(tileRes.buffer).metadata();
        if (meta.width === 1 && meta.height === 1) continue;
        const stats = await sharp(tileRes.buffer).stats();
        const mean = (stats.channels[0].mean + stats.channels[1].mean + stats.channels[2].mean) / 3;
        if (mean < BLACK_MEAN_THRESHOLD) {
          const stdev = Math.max(stats.channels[0].stdev || 0, stats.channels[1].stdev || 0, stats.channels[2].stdev || 0);
          const entropy = stats.entropy != null ? stats.entropy : 0;
          if (entropy < MIN_ENTROPY && stdev < MIN_STDEV) use = false;
        }
      } catch (_) {}
      if (use) tiles.push({ buffer: tileRes.buffer, left: col * step, top: row * step });
    }
  }
  if (tiles.length === 0 || width <= 0 || height <= 0) return null;
  const compositeInput = tiles.map((t) => ({ input: t.buffer, left: t.left, top: t.top }));
  const stitched = await sharp({
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
  const bbox = await getContentBbox(stitched);
  const toEncode = bbox
    ? await sharp(stitched).flatten({ background: { r: 255, g: 255, b: 255 } }).extract(bbox)
    : sharp(stitched);
  return await toEncode.webp({ quality: 92 }).toBuffer();
}

/** Запасной вариант: статическое JPG с ЦБ (когда DZI-тайлы отдают 1×1 плейсхолдер). */
async function fetchLegacyJpgAsWebp(catalogNumber, side) {
  const cat = String(catalogNumber).trim();
  const jpgName = side === "obverse" ? cat + "r" : cat;
  const url = `${LEGACY_IMG_BASE}/${jpgName}.jpg`;
  const res = await fetchBuffer(url);
  if (!res.ok || !res.buffer?.length || res.buffer.length < 500) return null;
  try {
    const img = sharp(res.buffer);
    const meta = await img.metadata();
    if (!meta.width || meta.width < 10 || !meta.height || meta.height < 10) return null;
    const bbox = await getContentBbox(res.buffer);
    const toEncode = bbox
      ? await img.flatten({ background: { r: 255, g: 255, b: 255 } }).extract(bbox)
      : img;
    return await toEncode.webp({ quality: 92 }).toBuffer();
  } catch (_) {
    return null;
  }
}

async function run() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL не задан в .env");
    process.exit(1);
  }
  const m = url.match(/mysql:\/\/([^:]+):([^@]+)@([^:]+):(\d+)\/(.+)/);
  if (!m) {
    console.error("Неверный формат DATABASE_URL");
    process.exit(1);
  }
  const [, user, password, host, port, database] = m;
  const conn = await mysql.createConnection({
    host,
    port: parseInt(port, 10),
    user,
    password,
    database,
  });

  const [rows] = await conn.execute(
    `SELECT DISTINCT catalog_number FROM coins WHERE catalog_number IS NOT NULL AND catalog_number != '' ORDER BY catalog_number LIMIT ?`,
    [LIMIT]
  );

  if (!fs.existsSync(OUT_DIR)) {
    fs.mkdirSync(OUT_DIR, { recursive: true });
    console.log("Создана папка:", OUT_DIR);
  }
  console.log("Монет к загрузке:", rows.length, "(лимит", LIMIT + ")");
  console.log("");

  let ok = 0;
  let fail = 0;
  for (const row of rows) {
    const cat = String(row.catalog_number).trim();
    const obverseWebp = cat + ".webp";
    const reverseWebp = cat + "r.webp";
    const obversePath = path.join(OUT_DIR, obverseWebp);
    const reversePath = path.join(OUT_DIR, reverseWebp);

    const MIN_VALID_SIZE = 1000;
    let obverseBuf = await fetchDziAsWebp(cat, "obverse");
    if (!obverseBuf || obverseBuf.length < MIN_VALID_SIZE) {
      obverseBuf = await fetchLegacyJpgAsWebp(cat, "obverse");
    }
    const obverseOk = obverseBuf && obverseBuf.length >= MIN_VALID_SIZE;
    if (obverseOk) {
      fs.writeFileSync(obversePath, obverseBuf);
      console.log("  ✓", obverseWebp, obverseBuf.length, "байт");
      ok++;
    } else {
      if (fs.existsSync(obversePath)) {
        fs.unlinkSync(obversePath);
        console.log("  —", obverseWebp, "удалён (битый/пустой)");
      } else {
        console.log("  —", obverseWebp, "не загрузился");
      }
      fail++;
    }
    await new Promise((r) => setTimeout(r, 200));

    let reverseBuf = await fetchDziAsWebp(cat, "reverse");
    if (!reverseBuf || reverseBuf.length < MIN_VALID_SIZE) {
      reverseBuf = await fetchLegacyJpgAsWebp(cat, "reverse");
    }
    const reverseOk = reverseBuf && reverseBuf.length >= MIN_VALID_SIZE;
    if (reverseOk) {
      fs.writeFileSync(reversePath, reverseBuf);
      console.log("  ✓", reverseWebp, reverseBuf.length, "байт");
      ok++;
    } else {
      if (fs.existsSync(reversePath)) {
        fs.unlinkSync(reversePath);
        console.log("  —", reverseWebp, "удалён (битый/пустой)");
      } else {
        console.log("  —", reverseWebp, "не загрузился");
      }
      fail++;
    }

    const obversePathDb = obverseOk ? "/image/coins/" + obverseWebp : null;
    const reversePathDb = reverseOk ? "/image/coins/" + reverseWebp : null;
    await conn.execute(
      "UPDATE coins SET image_obverse = ?, image_reverse = ? WHERE catalog_number = ?",
      [obversePathDb, reversePathDb, cat]
    );
    if (obverseOk || reverseOk) {
      console.log("  → БД обновлена для", cat);
    }
    console.log("");
    await new Promise((r) => setTimeout(r, 400));
  }

  await conn.end();
  console.log("Готово. Успешно:", ok, "файлов. Ошибок/пропусков:", fail);
  console.log("Файлы:", OUT_DIR);
  console.log("Дальше: npm run build → залить out на сервер. На сайте будут только монеты с картинками в БД.");
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
