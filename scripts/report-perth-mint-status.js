/**
 * Отчёт по Perth Mint: какие монеты нормально забрались, у кого нет JSON/спеок/картинок, какие не попали в прогресс (ошибки).
 * Дубликаты картинок не считаем здесь — для них отдельно: node scripts/dedupe-perth-mint-images.js --dry-run
 *
 * Запуск: node scripts/report-perth-mint-status.js
 */
const fs = require("fs");
const path = require("path");

const DATA_DIR = path.join(__dirname, "..", "data");
const URL_LIST_FILE = path.join(__dirname, "perth-mint-urls.txt");
const PROGRESS_FILE = path.join(DATA_DIR, "perth-mint-fetch-progress.json");

function normalizeUrl(u) {
  return String(u).trim().replace(/\/$/, "") || u;
}

function loadProgress() {
  if (!fs.existsSync(PROGRESS_FILE)) return { completedUrls: [], coins: [] };
  const raw = JSON.parse(fs.readFileSync(PROGRESS_FILE, "utf8"));
  return {
    completedUrls: Array.isArray(raw.completedUrls) ? raw.completedUrls : [],
    coins: Array.isArray(raw.coins) ? raw.coins : [],
  };
}

function getUrlList() {
  if (!fs.existsSync(URL_LIST_FILE)) return [];
  const text = fs.readFileSync(URL_LIST_FILE, "utf8");
  return text
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter((s) => s && (s.startsWith("http://") || s.startsWith("https://")));
}

function run() {
  const progress = loadProgress();
  const allUrls = getUrlList();
  const completedSet = new Set(progress.completedUrls.map(normalizeUrl));

  const ok = [];
  const noJson = [];
  const noSpecs = [];
  const noImages = [];
  const byStatus = { ok: [], partial: [] };

  for (let i = 0; i < progress.coins.length; i++) {
    const c = progress.coins[i];
    let jsonPath = c.jsonPath;
    if (jsonPath && path.isAbsolute(jsonPath) && !fs.existsSync(jsonPath)) jsonPath = path.join(DATA_DIR, path.basename(jsonPath));
    if (!jsonPath) jsonPath = path.join(DATA_DIR, path.basename(c.jsonPath || ""));
    if (!path.isAbsolute(jsonPath)) jsonPath = path.join(DATA_DIR, path.basename(jsonPath));
    const jsonPathRel = path.relative(path.join(DATA_DIR, ".."), jsonPath);
    const exists = fs.existsSync(jsonPath);
    if (!exists) {
      noJson.push({ url: c.url, title: c.title, jsonPath: jsonPathRel });
      continue;
    }
    let raw;
    try {
      raw = JSON.parse(fs.readFileSync(jsonPath, "utf8"));
    } catch {
      noJson.push({ url: c.url, title: c.title, jsonPath: jsonPathRel });
      continue;
    }
    const coin = raw.coin || {};
    const hasSpecs = raw.raw && raw.raw.specs && Object.keys(raw.raw.specs).length > 0;
    const hasImg = !!(coin.image_obverse || coin.image_reverse);
    if (!hasSpecs) noSpecs.push({ url: c.url, title: coin.title || c.title });
    if (!hasImg) noImages.push({ url: c.url, title: coin.title || c.title });
    if (hasSpecs && hasImg) ok.push({ url: c.url, title: coin.title || c.title, status: c.status });
    if (c.status === "partial") byStatus.partial.push(c.url);
    else byStatus.ok.push(c.url);
  }

  const notInProgress = allUrls.filter((u) => !completedSet.has(normalizeUrl(u)));

  console.log("=== Perth Mint: отчёт по прогрессу ===\n");
  console.log("В списке URL:", allUrls.length);
  console.log("В прогрессе (обработано когда-либо):", progress.completedUrls.length);
  console.log("Не в прогрессе (ещё не брали или ошибка при fetch):", notInProgress.length);
  console.log("");
  console.log("По полноте данных (из записей в прогрессе):");
  console.log("  OK (есть спеки и хотя бы одна картинка):", ok.length);
  console.log("  Нет JSON или не читается:", noJson.length);
  console.log("  Нет спеок в raw.specs:", noSpecs.length);
  console.log("  Нет картинок (obverse/reverse):", noImages.length);
  console.log("По статусу при fetch: ok —", byStatus.ok.length, ", partial (без основных картинок) —", byStatus.partial.length);
  if (notInProgress.length > 0) {
    console.log("\n--- URL не в прогрессе (нужно забрать или проверить ошибки) ---");
    notInProgress.slice(0, 20).forEach((u) => console.log(" ", u));
    if (notInProgress.length > 20) console.log(" ... и ещё", notInProgress.length - 20);
  }
  if (noJson.length > 0) {
    console.log("\n--- Нет JSON / не читается ---");
    noJson.slice(0, 10).forEach((x) => console.log(" ", x.title || x.url));
    if (noJson.length > 10) console.log(" ... и ещё", noJson.length - 10);
  }
  if (noImages.length > 0 && noImages.length <= 15) {
    console.log("\n--- Без картинок obverse/reverse ---");
    noImages.forEach((x) => console.log(" ", x.title || x.url));
  } else if (noImages.length > 15) {
    console.log("\n--- Без картинок (первые 15) ---");
    noImages.slice(0, 15).forEach((x) => console.log(" ", x.title || x.url));
    console.log(" ... и ещё", noImages.length - 15);
  }
  console.log("\nДубликаты изображений по содержимому: node scripts/dedupe-perth-mint-images.js --dry-run");
}

run();
