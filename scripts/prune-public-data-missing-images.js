/**
 * Убирает из public/data/coins.json и public/data/coins/<id>.json ссылки на локальные
 * /image/... файлы, которых нет в public/ (чтобы карточка и галерея не запрашивали 404).
 *
 * Внешние URL (http…) не трогает. После npm run data:export можно снова запустить этот скрипт.
 *
 *   node scripts/prune-public-data-missing-images.js
 */
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const PUBLIC = path.join(ROOT, "public");
const DATA_DIR = path.join(ROOT, "public", "data");
const COINS_LIST = path.join(DATA_DIR, "coins.json");
const COINS_DIR = path.join(DATA_DIR, "coins");
const PLACEHOLDER = "/image/coin-placeholder.png";

function fileExistsLocal(u) {
  if (u == null || typeof u !== "string") return false;
  const t = u.trim();
  if (!t.startsWith("/")) return true;
  return fs.existsSync(path.join(PUBLIC, t.replace(/^\//, "")));
}

function pruneCoinObject(coin) {
  if (!coin || typeof coin !== "object") return;
  const urls = Array.isArray(coin.imageUrls) ? coin.imageUrls.map((x) => String(x || "").trim()).filter(Boolean) : [];
  const roles = Array.isArray(coin.imageUrlRoles) ? coin.imageUrlRoles : [];
  const outUrls = [];
  const outRoles = [];
  const seen = new Set();
  for (let i = 0; i < urls.length; i++) {
    const u = urls[i];
    if (!fileExistsLocal(u)) continue;
    if (seen.has(u)) continue;
    seen.add(u);
    outUrls.push(u);
    outRoles.push(roles[i]);
  }
  let imageUrl = coin.imageUrl != null ? String(coin.imageUrl).trim() : "";
  if (imageUrl && !fileExistsLocal(imageUrl)) {
    imageUrl = outUrls[0] || PLACEHOLDER;
  }
  if (!imageUrl) imageUrl = outUrls[0] || PLACEHOLDER;
  coin.imageUrl = imageUrl;
  const hasRoles = outRoles.some((r) => r != null && String(r).trim() !== "");
  if (outUrls.length > 1) {
    coin.imageUrls = outUrls;
    coin.imageUrlRoles = hasRoles ? outRoles : undefined;
  } else {
    delete coin.imageUrls;
    delete coin.imageUrlRoles;
  }
}

function pruneDetailFile(fp) {
  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(fp, "utf8"));
  } catch {
    return false;
  }
  if (raw.coin) pruneCoinObject(raw.coin);
  if (Array.isArray(raw.sameSeries)) {
    for (const s of raw.sameSeries) {
      if (!s || typeof s !== "object") continue;
      const u = s.imageUrl != null ? String(s.imageUrl).trim() : "";
      if (u && !fileExistsLocal(u)) s.imageUrl = PLACEHOLDER;
    }
  }
  fs.writeFileSync(fp, JSON.stringify(raw) + "\n", "utf8");
  return true;
}

function collectMissingFromCoins(coins) {
  const miss = new Set();
  for (const c of coins) {
    const urls = [];
    if (c.imageUrl) urls.push(c.imageUrl);
    if (Array.isArray(c.imageUrls)) urls.push(...c.imageUrls);
    for (const u of urls) {
      const t = String(u || "").trim();
      if (!t.startsWith("/image/")) continue;
      if (!fileExistsLocal(t)) miss.add(t);
    }
  }
  return miss;
}

function categorizeMissing(paths) {
  const cat = { box: 0, cert: 0, imgSlot: 0, blister: 0, other: 0 };
  for (const p of paths) {
    const b = path.basename(p);
    if (/-box\.webp$/i.test(b)) cat.box++;
    else if (/-cert\.webp$/i.test(b)) cat.cert++;
    else if (/-img-\d+\.webp$/i.test(b)) cat.imgSlot++;
    else if (/blister/i.test(b)) cat.blister++;
    else cat.other++;
  }
  return cat;
}

function main() {
  if (!fs.existsSync(COINS_LIST)) {
    console.error("Нет файла", COINS_LIST);
    process.exit(1);
  }
  const listRaw = JSON.parse(fs.readFileSync(COINS_LIST, "utf8"));
  const coins = listRaw.coins;
  if (!Array.isArray(coins)) {
    console.error("coins.json: нет массива coins");
    process.exit(1);
  }
  const missingBefore = collectMissingFromCoins(coins);
  const byCat = categorizeMissing(missingBefore);

  for (const c of coins) pruneCoinObject(c);
  fs.writeFileSync(COINS_LIST, JSON.stringify(listRaw) + "\n", "utf8");

  let detailOk = 0;
  if (fs.existsSync(COINS_DIR)) {
    for (const name of fs.readdirSync(COINS_DIR)) {
      if (!name.endsWith(".json")) continue;
      if (pruneDetailFile(path.join(COINS_DIR, name))) detailOk++;
    }
  }

  console.log(
    JSON.stringify(
      {
        listCoins: coins.length,
        uniqueLocalPathsMissingBeforePrune: missingBefore.size,
        missingByBasenameKind: byCat,
        detailJsonFilesUpdated: detailOk,
        note:
          "Чтобы вернуть отсутствующие кадры в данные, докачайте файлы и выполните data:export или обновите БД.",
      },
      null,
      2
    )
  );
}

main();
