/**
 * Создаёт папку для визуального сравнения наших картинок с оригиналами Perth Mint.
 * Сопоставление только по source_url из БД. Скачивание — как в redownload-perth-images-from-raw.js:
 * fetch с User-Agent, только картинки этого продукта (папка в пути), без "you may also like".
 *
 * Структура:
 *   data/perth-compare/<id>/current  — копии текущих картинок с сайта (public/image/...)
 *   data/perth-compare/<id>/perth   — картинки Perth по raw.imageUrls каноника (фильтр по папке продукта)
 *
 * Запуск:
 *   node scripts/compare-perth-images.js
 */
require("dotenv").config({ path: ".env" });
const fs = require("fs");
const path = require("path");
const mysql = require("mysql2/promise");

const ROOT = path.join(__dirname, "..");
const DATA_DIR = path.join(ROOT, "data");
const PUBLIC_DIR = path.join(ROOT, "public");
const PUBLIC_COINS_DIR = path.join(PUBLIC_DIR, "data", "coins");
const PERTH_COMPARE_DIR = path.join(DATA_DIR, "perth-compare");
const BASE_URL = "https://www.perthmint.com";
const GALLERY_HEAD_COUNT = 15; // как в redownload: галерея товара в начале, "you may also like" — дальше

// Набор монет, которые сейчас хотим проверить
const IDS = ["4429", "4432", "4542", "4541", "5762", "4424", "4757"];

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function normalizeSourceUrl(url) {
  if (url == null || typeof url !== "string") return null;
  const s = url.trim().replace(/\/+$/, "");
  return s || null;
}

/** Папка продукта в пути картинки (как в redownload-perth-images-from-raw.js). */
function extractFolder(imgUrl) {
  const str = String(imgUrl);
  const m = str.match(/\/coins\/(?:01\.-archive\/)?(?:20\d{2}|19\d{2}|2012-2020)\/([a-z0-9]+)\//i);
  return m ? m[1].toLowerCase() : null;
}

/** Как в redownload: только User-Agent, width=2000 для высокого разрешения. */
async function downloadToFile(imgUrl, dest) {
  const fullUrl = (imgUrl.startsWith("http") ? imgUrl : BASE_URL + imgUrl).replace(/width=\d+/gi, "width=2000");
  const res = await fetch(fullUrl, {
    headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0 Safari/537.36" },
    redirect: "follow",
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} для ${fullUrl}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length < 500) throw new Error("Слишком маленький ответ");
  fs.writeFileSync(dest, buf);
}

function slugFromSourceUrl(url) {
  if (!url) return null;
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

async function main() {
  ensureDir(PERTH_COMPARE_DIR);

  // Каноники Perth: индекс по нормализованному source_url (один URL = один продукт)
  const perthFiles = fs
    .readdirSync(DATA_DIR)
    .filter((f) => f.startsWith("perth-mint-") && f.endsWith(".json"));

  const perthBySourceUrl = new Map();
  for (const f of perthFiles) {
    try {
      const full = path.join(DATA_DIR, f);
      const json = JSON.parse(fs.readFileSync(full, "utf8"));
      const coin = json.coin || {};
      const raw = json.raw || {};
      const url = coin.source_url || raw.source_url;
      const norm = normalizeSourceUrl(url);
      if (norm && String(url || "").includes("perthmint.com")) {
        perthBySourceUrl.set(norm, full);
      }
    } catch {
      // пропускаем битые файлы
    }
  }
  console.log("Каноников Perth по source_url:", perthBySourceUrl.size);

  // source_url для наших монет — только из БД (в public JSON его нет)
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL не задан. Нужен для чтения source_url монет.");
    process.exit(1);
  }
  const m = url.match(/mysql:\/\/([^:]+):([^@]+)@([^:]+):(\d+)\/(.+)/);
  if (!m) {
    console.error("Неверный формат DATABASE_URL");
    process.exit(1);
  }
  const [, user, password, host, port, database] = m;
  const conn = await mysql.createConnection({ host, port: parseInt(port, 10), user, password, database });

  const placeholders = IDS.map(() => "?").join(",");
  const [rows] = await conn.execute(
    `SELECT id, title, source_url FROM coins WHERE id IN (${placeholders})`,
    IDS
  );
  await conn.end();

  const coinById = new Map(rows.map((r) => [String(r.id), { title: r.title, source_url: r.source_url }]));

  for (const id of IDS) {
    const coin = coinById.get(id);
    if (!coin) {
      console.warn(`id=${id}: нет в БД, пропуск`);
      continue;
    }

    const coinSourceUrl = coin.source_url ? normalizeSourceUrl(coin.source_url) : null;
    if (!coinSourceUrl || !coinSourceUrl.includes("perthmint.com")) {
      console.warn(`id=${id}: нет source_url (perthmint.com) в БД — пропуск Perth-части`);
    }

    const coinJsonPath = path.join(PUBLIC_COINS_DIR, `${id}.json`);
    if (!fs.existsSync(coinJsonPath)) {
      console.warn(`id=${id}: нет public/data/coins/${id}.json`);
      continue;
    }

    const json = JSON.parse(fs.readFileSync(coinJsonPath, "utf8"));
    const publicCoin = json.coin || {};

    const baseDir = path.join(PERTH_COMPARE_DIR, id);
    const currentDir = path.join(baseDir, "current");
    const perthDir = path.join(baseDir, "perth");
    ensureDir(currentDir);
    ensureDir(perthDir);

    // Копируем текущие изображения с сайта
    const allCurrent = [publicCoin.imageUrl, ...(Array.isArray(publicCoin.imageUrls) ? publicCoin.imageUrls : [])].filter(Boolean);
    for (const rel of allCurrent) {
      try {
        const src = path.join(PUBLIC_DIR, rel.startsWith("/") ? rel.slice(1) : rel);
        if (!fs.existsSync(src)) continue;
        const name = path.basename(src);
        const dest = path.join(currentDir, name);
        fs.copyFileSync(src, dest);
      } catch (err) {
        console.warn(`  Не удалось скопировать ${rel} для id=${id}:`, err.message);
      }
    }

    // Perth: только по source_url из БД
    const perthPath = coinSourceUrl ? perthBySourceUrl.get(coinSourceUrl) : null;
    if (!perthPath) {
      if (coinSourceUrl) {
        console.warn(`id=${id}: каноник по source_url не найден (проверьте data/perth-mint-*.json)`);
      }
      continue;
    }

    const perthJson = JSON.parse(fs.readFileSync(perthPath, "utf8"));
    const perthCoin = perthJson.coin || {};
    const raw = perthJson.raw || {};
    const slug = slugFromSourceUrl(perthCoin.source_url || raw.source_url);

    // Как в redownload-perth-images-from-raw: только картинки этого продукта (папка в пути)
    const rawUrls = Array.isArray(raw.imageUrls) ? raw.imageUrls : [];
    const coinUrls = rawUrls.filter((u) => u && (u.includes("/coins/") || u.includes("product")));
    const headUrls = coinUrls.slice(0, GALLERY_HEAD_COUNT);
    const folderCounts = {};
    headUrls.forEach((u) => {
      const f = extractFolder(u);
      if (f) folderCounts[f] = (folderCounts[f] || 0) + 1;
    });
    const best = Object.entries(folderCounts).sort((a, b) => b[1] - a[1])[0];
    const productFolder = best ? best[0] : null;
    const byProduct = productFolder ? coinUrls.filter((u) => extractFolder(u) === productFolder) : coinUrls;
    const toDownload = byProduct.filter((u) => typeof u === "string" && u.includes("/product-images"));

    console.log(`id=${id}: ${toDownload.length} картинок Perth (slug=${slug}${productFolder ? ", папка=" + productFolder : ""})`);

    for (let i = 0; i < toDownload.length; i++) {
      const imgUrl = toDownload[i];
      const fullUrl = imgUrl.startsWith("http") ? imgUrl : BASE_URL + imgUrl;
      const stem = path.basename(fullUrl.split("?")[0]) || `img-${i + 1}`;
      const dest = path.join(perthDir, stem);
      try {
        if (fs.existsSync(dest)) continue;
        await downloadToFile(imgUrl, dest);
      } catch (err) {
        console.warn(`  Не удалось скачать:`, err.message);
      }
    }
  }

  console.log(`Готово. Сравнивайте картинки в ${path.relative(process.cwd(), PERTH_COMPARE_DIR)}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
