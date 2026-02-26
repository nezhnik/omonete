/**
 * Скачивает изображения с ЦБ: для каждой монеты используется полный каталожный номер с суффиксом
 * (как на cbr.ru: ShowCoins/?cat_num=5111-0178-17 и DZI ?tilesources=5111-0178-17 / 5111-0178-17r).
 * Файлы: 5111-0178.webp, 5111-0178-17.webp, … — каждому catalog_number свой файл и обновление только своих записей.
 *
 * Запуск: node scripts/download-dzi-coins-by-base.js       — первые 100 баз (или продолжение с прогресса)
 *         node scripts/download-dzi-coins-by-base.js 200    — 200 баз
 *         node scripts/download-dzi-coins-by-base.js --all   — все
 *         node scripts/download-dzi-coins-by-base.js --from-start --all — с начала, игнорируя прогресс
 *         node scripts/download-dzi-coins-by-base.js --only=5115-0164,5214-0009,... — докачать только указанные базы
 * Прогресс: сохраняется в .download-dzi-by-base-progress.json, следующий запуск продолжает с последней позиции.
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
const PROGRESS_FILE = path.join(__dirname, ".download-dzi-by-base-progress.json");
const MIN_VALID_SIZE = 1000;
const limitArg = process.argv.find((a) => /^\d+$/.test(a));
const FROM_START = process.argv.includes("--from-start");
const onlyArg = process.argv.find((a) => a.startsWith("--only="));
const ONLY_BASES = onlyArg ? onlyArg.replace("--only=", "").split(",").map((b) => b.trim()).filter(Boolean) : null;
const LIMIT = process.argv.includes("--all") ? 10000 : (limitArg ? parseInt(limitArg, 10) : 100);

const BROWSER_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  Accept: "text/html,application/xhtml+xml,image/webp,image/apng,*/*",
  "Accept-Language": "ru-RU,ru;q=0.9,en;q=0.8",
  Referer: "https://www.cbr.ru/",
};

const WHITE_THRESHOLD = 235;

function catalogToBase(cat) {
  if (!cat || typeof cat !== "string") return cat;
  return cat.trim().replace(/-(\d{1,2})$/, "");
}

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
    create: { width, height, channels: 4, background: { r: 255, g: 255, b: 255, alpha: 1 } },
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

/** Запасной вариант: статическое JPG с ЦБ (для монет, у которых DZI-тайлы отдают 1×1 плейсхолдер). */
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
  const connConfig = {
    host,
    port: parseInt(port, 10),
    user,
    password,
    database,
  };
  let conn = await mysql.createConnection(connConfig);

  /** Выполнить запрос; при обрыве соединения (ECONNRESET) переподключиться и повторить один раз. */
  async function dbExecute(sql, params) {
    try {
      return await conn.execute(sql, params);
    } catch (e) {
      const isConnLost = e?.code === "ECONNRESET" || e?.code === "PROTOCOL_CONNECTION_LOST" || e?.errno === -54;
      if (isConnLost) {
        try {
          await conn.end();
        } catch (_) {}
        console.log("  ↻ переподключение к БД...");
        conn = await mysql.createConnection(connConfig);
        return await conn.execute(sql, params);
      }
      throw e;
    }
  }

  const [rows] = await dbExecute(
    `SELECT catalog_number FROM coins WHERE catalog_number IS NOT NULL AND catalog_number != ''`
  );
  const bases = [...new Set(rows.map((r) => catalogToBase(r.catalog_number)))].sort();
  if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });

  let startIndex = 0;
  let limited;
  if (ONLY_BASES && ONLY_BASES.length > 0) {
    limited = ONLY_BASES;
    console.log("Режим --only: обрабатываем", limited.length, "баз:", limited.join(", "));
  } else {
    if (!FROM_START && fs.existsSync(PROGRESS_FILE)) {
      try {
        const p = JSON.parse(fs.readFileSync(PROGRESS_FILE, "utf8"));
        if (p.lastIndex != null && p.lastIndex >= 0 && p.lastIndex < bases.length) {
          startIndex = p.lastIndex + 1;
          console.log("Продолжаем с позиции", startIndex + 1, "/", bases.length);
        }
      } catch (_) {}
    }
    limited = bases.slice(startIndex).slice(0, LIMIT);
    console.log("Всего баз:", bases.length, "| обрабатываем:", limited.length, "шт.");
  }
  if (limited.length === 0) {
    await conn.end();
    console.log("Готово. Нечего качать. (Для прохода с начала: --from-start --all или удалите", path.basename(PROGRESS_FILE) + ")");
    return;
  }

  const PAUSE_EVERY = 150;
  const PAUSE_MS = 1 * 60 * 1000;
  let ok = 0;
  let fail = 0;
  for (let i = 0; i < limited.length; i++) {
    if (i > 0 && i % PAUSE_EVERY === 0) {
      console.log("  Пауза 1 мин (чтобы не перегружать сервер ЦБ)...");
      await new Promise((r) => setTimeout(r, PAUSE_MS));
    }
    const base = limited[i];
    // Все полные каталожные номера этой базы (5111-0178, 5111-0178-10, … 5111-0178-26). DZI на ЦБ — по полному номеру с суффиксом.
    const allCats = [...new Set(rows.filter((r) => catalogToBase(r.catalog_number) === base).map((r) => r.catalog_number))].sort();

    for (const cat of allCats) {
      const obverseWebp = cat + ".webp";
      const reverseWebp = cat + "r.webp";
      const obversePath = path.join(OUT_DIR, obverseWebp);
      const reversePath = path.join(OUT_DIR, reverseWebp);

      const obverseExists = fs.existsSync(obversePath) && fs.statSync(obversePath).size >= MIN_VALID_SIZE;
      const reverseExists = fs.existsSync(reversePath) && fs.statSync(reversePath).size >= MIN_VALID_SIZE;
      if (!ONLY_BASES && obverseExists && reverseExists) {
        await dbExecute(
          `UPDATE coins SET image_obverse = ?, image_reverse = ? WHERE catalog_number = ?`,
          ["/image/coins/" + obverseWebp, "/image/coins/" + reverseWebp, cat]
        );
        await new Promise((r) => setTimeout(r, 50));
        continue;
      }

      let obverseOk = false;
      let reverseOk = false;
      let hadNetworkError = false;
      try {
        let obverseBuf = obverseExists ? fs.readFileSync(obversePath) : null;
        let reverseBuf = reverseExists ? fs.readFileSync(reversePath) : null;
        if (!obverseBuf || obverseBuf.length < MIN_VALID_SIZE) {
          obverseBuf = await fetchDziAsWebp(cat, "obverse");
          if (!obverseBuf || obverseBuf.length < MIN_VALID_SIZE) obverseBuf = await fetchLegacyJpgAsWebp(cat, "obverse");
        }
        if (!reverseBuf || reverseBuf.length < MIN_VALID_SIZE) {
          reverseBuf = await fetchDziAsWebp(cat, "reverse");
          if (!reverseBuf || reverseBuf.length < MIN_VALID_SIZE) reverseBuf = await fetchLegacyJpgAsWebp(cat, "reverse");
        }
        obverseOk = obverseBuf && obverseBuf.length >= MIN_VALID_SIZE;
        reverseOk = reverseBuf && reverseBuf.length >= MIN_VALID_SIZE;
        if (obverseOk) {
          fs.writeFileSync(obversePath, obverseBuf);
          ok++;
        }
        if (reverseOk) {
          fs.writeFileSync(reversePath, reverseBuf);
          ok++;
        }
        if (!obverseOk || !reverseOk) fail += 2;
        await new Promise((r) => setTimeout(r, 200));
      } catch (err) {
        hadNetworkError = true;
        const msg = err?.cause?.code || err?.code || err?.message || "";
        console.log("  ✗", cat, "ошибка:", msg, "— пауза 15 сек...");
        fail += 2;
        await new Promise((r) => setTimeout(r, 15000));
      }

      const obversePathDb = obverseOk ? "/image/coins/" + obverseWebp : null;
      const reversePathDb = reverseOk ? "/image/coins/" + reverseWebp : null;
      await dbExecute(
        `UPDATE coins SET image_obverse = ?, image_reverse = ? WHERE catalog_number = ?`,
        [obversePathDb, reversePathDb, cat]
      );
      if (obverseOk || reverseOk) {
        console.log("  ✓", cat, obverseOk && reverseOk ? "оба" : "частично");
      } else if (!hadNetworkError) {
        console.log("  —", cat, "не загрузился");
      }
      await new Promise((r) => setTimeout(r, 400));
    }

    if (!ONLY_BASES) {
      const currentIndex = startIndex + i;
      fs.writeFileSync(PROGRESS_FILE, JSON.stringify({ lastIndex: currentIndex, totalBases: bases.length }, null, 2));
    }
  }

  await conn.end();
  console.log("Готово. Успешно файлов:", ok, "Ошибок:", fail);
  if (!ONLY_BASES && startIndex + limited.length >= bases.length) {
    try {
      fs.unlinkSync(PROGRESS_FILE);
      console.log("Прогресс сброшен (все обработаны). Следующий запуск начнёт с начала.");
    } catch (_) {}
  }
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
