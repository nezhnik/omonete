/**
 * Сравнение качества: картинка из legacy/PhotoStore vs DZI (высокое качество).
 * Скачивает все тайлы DZI макс. уровня, склеивает в одно изображение, сохраняет в public/image/compare-quality/.
 *
 * Запуск: node scripts/compare-coin-image-sources.js [каталожный_номер]
 * Пример: node scripts/compare-coin-image-sources.js 5109-0128
 */
const fs = require("fs");
const path = require("path");
const sharp = require("sharp");

const CATALOG_NUM = process.argv[2] || "5109-0128";
const OUT_DIR = path.join(__dirname, "..", "public", "image", "compare-quality");

const LEGACY_BASE = "https://www.cbr.ru/legacy/PhotoStore/img";
const DZI_PAGE = "https://www.cbr.ru/dzi/";

const BROWSER_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  Accept: "text/html,application/xhtml+xml,image/webp,image/apng,*/*",
  "Accept-Language": "ru-RU,ru;q=0.9,en;q=0.8",
};

async function fetchBuffer(url, headers = {}) {
  const res = await fetch(url, {
    redirect: "follow",
    headers: { ...BROWSER_HEADERS, ...headers },
  });
  if (!res.ok) return { ok: false, status: res.status };
  return { ok: true, buffer: Buffer.from(await res.arrayBuffer()) };
}

async function fetchText(url) {
  const res = await fetch(url, { redirect: "follow", headers: BROWSER_HEADERS });
  if (!res.ok) return null;
  return res.text();
}

async function run() {
  if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });

  console.log("Каталожный номер:", CATALOG_NUM);
  console.log("Папка для сравнения:", OUT_DIR);
  console.log("");

  // 1) Текущий источник: legacy JPG (аверс и реверс по нашему соглашению)
  const legacyObverseUrl = `${LEGACY_BASE}/${CATALOG_NUM}r.jpg`;
  const legacyReverseUrl = `${LEGACY_BASE}/${CATALOG_NUM}.jpg`;

  const r1 = await fetchBuffer(legacyObverseUrl);
  if (r1.ok && r1.buffer.length > 0) {
    fs.writeFileSync(path.join(OUT_DIR, `${CATALOG_NUM}_legacy_obverse.jpg`), r1.buffer);
    console.log("✓ legacy аверс:", r1.buffer.length, "байт →", `${CATALOG_NUM}_legacy_obverse.jpg`);
  } else {
    console.log("— legacy аверс не удалось:", r1.status || "нет данных");
  }

  const r2 = await fetchBuffer(legacyReverseUrl);
  if (r2.ok && r2.buffer.length > 0) {
    fs.writeFileSync(path.join(OUT_DIR, `${CATALOG_NUM}_legacy_reverse.jpg`), r2.buffer);
    console.log("✓ legacy реверс:", r2.buffer.length, "байт →", `${CATALOG_NUM}_legacy_reverse.jpg`);
  } else {
    console.log("— legacy реверс не удалось:", r2.status || "нет данных");
  }

  // 2) Страница DZI — из неё берём путь к высокому качеству (dzc_output.xml)
  const dziPageUrl = `${DZI_PAGE}?tilesources=${CATALOG_NUM}r`;
  const html = await fetchText(dziPageUrl);
  if (html) {
    fs.writeFileSync(path.join(OUT_DIR, `${CATALOG_NUM}_dzi_page.html`), html);
    console.log("✓ DZI страница сохранена →", `${CATALOG_NUM}_dzi_page.html`);

    const base = "https://www.cbr.ru";
    const tileSourcesMatch = html.match(/tileSources:\s*["']([^"']+)["']/);
    if (tileSourcesMatch) {
      const xmlPath = tileSourcesMatch[1];
      const xmlUrl = xmlPath.startsWith("http") ? xmlPath : base + (xmlPath.startsWith("/") ? xmlPath : "/" + xmlPath);
      console.log("  Найден tileSources:", xmlPath);

      const xmlRes = await fetchBuffer(xmlUrl);
      if (xmlRes.ok && xmlRes.buffer.length > 0) {
        fs.writeFileSync(path.join(OUT_DIR, `${CATALOG_NUM}_dzc_output.xml`), xmlRes.buffer);
        console.log("✓ XML метаданных сохранён →", `${CATALOG_NUM}_dzc_output.xml`);

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
        const filesBaseUrl = base + (filesDir.startsWith("/") ? filesDir : "/" + filesDir);
        const step = tileSize - overlap;
        const nx = Math.ceil(width / step);
        const ny = Math.ceil(height / step);
        const level = maxLevel;

        const tiles = [];
        for (let row = 0; row < ny; row++) {
          for (let col = 0; col < nx; col++) {
            const tileUrl = `${filesBaseUrl}/${level}/${col}_${row}.${ext}`;
            const tileRes = await fetchBuffer(tileUrl);
            if (tileRes.ok && tileRes.buffer.length > 0) {
              tiles.push({ buffer: tileRes.buffer, left: col * step, top: row * step });
            }
          }
        }

        if (tiles.length > 0 && width > 0 && height > 0) {
          const compositeInput = tiles.map((t) => ({ input: t.buffer, left: t.left, top: t.top }));
          const stitchedPng = await sharp({
            create: { width: Math.max(...tiles.map((t) => t.left + tileSize)), height: Math.max(...tiles.map((t) => t.top + tileSize)), channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
          })
            .composite(compositeInput)
            .extract({ left: 0, top: 0, width, height });
          const pngBuf = await stitchedPng.png().toBuffer();
          const outPng = path.join(OUT_DIR, `${CATALOG_NUM}_dzi_full.png`);
          fs.writeFileSync(outPng, pngBuf);
          console.log("✓ DZI склейка", tiles.length, "тайлов →", `${CATALOG_NUM}_dzi_full.png`, pngBuf.length, "байт", `(${width}×${height})`);
          const webpLossless = await sharp(pngBuf).webp({ lossless: true }).toBuffer();
          const outWebp = path.join(OUT_DIR, `${CATALOG_NUM}_dzi_full.webp`);
          fs.writeFileSync(outWebp, webpLossless);
          console.log("✓ WebP lossless (без потери качества) →", `${CATALOG_NUM}_dzi_full.webp`, webpLossless.length, "байт");

          const webp92 = await sharp(pngBuf).webp({ quality: 92 }).toBuffer();
          const outSmall = path.join(OUT_DIR, `${CATALOG_NUM}_dzi_full_75k.webp`);
          fs.writeFileSync(outSmall, webp92);
          console.log("✓ WebP (q=92) →", `${CATALOG_NUM}_dzi_full_75k.webp`, webp92.length, "байт");
        } else {
          console.log("  — тайлов не хватает или неверный XML (width/height)");
        }
      } else {
        console.log("  — XML не загрузился (статус:", xmlRes.status + "). Открой в браузере:", xmlUrl);
      }
    }
  } else {
    console.log("— DZI страница не загрузилась");
  }

  console.log("");
  console.log("Готово. Открой папку", OUT_DIR, "и сравни файлы по размеру и качеству.");
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
