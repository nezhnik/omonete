/**
 * Monnaie de Paris: меняет местами содержимое *-rev.webp ↔ *-pack.webp на диске (тройной rename).
 * Пути в JSON/БД не меняются — после обмена у слота reverse снова реверс, у packaging — упаковка.
 *
 * Источник пар путей: public/data/coins/{id}.json → imageUrls + imageUrlRoles (reverse / packaging).
 * Роль box не трогаем.
 *
 *   node scripts/swap-mdp-rev-pack-webp-by-coin-ids.js
 *   node scripts/swap-mdp-rev-pack-webp-by-coin-ids.js --apply
 */
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const FOREIGN_DIR = path.join(__dirname, "..", "public", "image", "coins", "foreign");
const COINS_DATA_DIR = path.join(__dirname, "..", "public", "data", "coins");

/** Список id от редактора (дубликаты убраны). */
const COIN_IDS = [
  7437, 7509, 7508, 7474, 7469, 7466, 7473, 7463, 7454, 7457, 7451, 7443, 7440, 7409, 7914, 7840,
  7837, 7831, 7825, 7798, 7797, 7796, 7626, 7625, 7577,
];

function foreignBasename(webPath) {
  if (!webPath || typeof webPath !== "string") return null;
  const s = webPath.trim();
  if (!s.includes("/foreign/")) return null;
  const rest = s.split("/").pop();
  if (!rest || !/\.webp$/i.test(rest) || rest.includes("..")) return null;
  return rest;
}

function pickRevPackFromCoinJson(coin) {
  const urls = coin.imageUrls || [];
  const roles = coin.imageUrlRoles || [];
  let revUrl;
  let packUrl;
  for (let i = 0; i < urls.length; i++) {
    const role = roles[i];
    if (role === "reverse") revUrl = urls[i];
    if (role === "packaging") packUrl = urls[i];
  }
  const revBase = foreignBasename(revUrl);
  const packBase = foreignBasename(packUrl);
  if (!revBase || !packBase) return { error: "нет reverse и/или packaging в JSON" };
  if (!/-rev\.webp$/i.test(revBase)) return { error: `reverse путь не *-rev.webp: ${revBase}` };
  if (!/-pack\.webp$/i.test(packBase)) return { error: `packaging путь не *-pack.webp: ${packBase}` };
  if (revBase.toLowerCase() === packBase.toLowerCase()) return { error: "rev и pack совпадают" };
  return { revBase, packBase };
}

function swapPair(revBase, packBase, label, dryRun) {
  const revPath = path.join(FOREIGN_DIR, revBase);
  const packPath = path.join(FOREIGN_DIR, packBase);
  if (!fs.existsSync(revPath) || !fs.existsSync(packPath)) {
    console.warn("Пропуск (нет файлов):", label, revBase, packBase);
    return false;
  }
  if (dryRun) {
    console.log("[dry-run] swap rev↔pack:", label, revBase, "↔", packBase);
    return true;
  }
  const tmp = path.join(FOREIGN_DIR, `.swap-${crypto.randomBytes(8).toString("hex")}-${revBase}`);
  fs.renameSync(revPath, tmp);
  fs.renameSync(packPath, revPath);
  fs.renameSync(tmp, packPath);
  console.log("OK:", label, revBase, "↔", packBase);
  return true;
}

function main() {
  const dryRun = !process.argv.includes("--apply");
  if (dryRun) console.log("Dry-run. Применить: node scripts/swap-mdp-rev-pack-webp-by-coin-ids.js --apply\n");

  if (!fs.existsSync(FOREIGN_DIR)) {
    console.error("Нет каталога:", FOREIGN_DIR);
    process.exit(1);
  }

  let ok = 0;
  let skip = 0;

  for (const id of COIN_IDS) {
    const jsonPath = path.join(COINS_DATA_DIR, `${id}.json`);
    if (!fs.existsSync(jsonPath)) {
      console.warn("Нет JSON:", id);
      skip++;
      continue;
    }
    let data;
    try {
      data = JSON.parse(fs.readFileSync(jsonPath, "utf8"));
    } catch (e) {
      console.warn("Битый JSON:", id, e.message);
      skip++;
      continue;
    }
    const coin = data.coin;
    if (!coin) {
      console.warn("Нет coin в JSON:", id);
      skip++;
      continue;
    }
    const picked = pickRevPackFromCoinJson(coin);
    if (picked.error) {
      console.warn(`Пропуск id=${id}: ${picked.error}`);
      skip++;
      continue;
    }
    if (swapPair(picked.revBase, picked.packBase, `id=${id}`, dryRun)) ok++;
    else skip++;
  }

  console.log("—");
  console.log(dryRun ? "Запланировано:" : "Выполнено обменов:", ok);
  console.log("Пропусков:", skip);
}

main();
