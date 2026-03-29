/**
 * Münze Österreich: обмен сторон аверс/реверс БЕЗ правок JSON и БД.
 *
 * Как устроено: тройной rename на диске — файлы *-obv.webp и *-rev.webp меняются
 * содержимым (имена путей в данных остаются теми же). Запуск из каталога omonete-app.
 *
 * Процесс:
 * 1) Сначала без --apply (dry-run) — проверить список «OK» / пропуски.
 * 2) Та же команда с --apply.
 * 3) Обновить страницу монеты с сбросом кэша картинок при необходимости.
 *
 * Точечно по id (для этих id не действует EXCLUDE_COIN_IDS):
 *   node scripts/swap-austrian-mint-obv-rev-webp-files.js --only-ids=7371,7299 --apply
 *
 * Массово по всем подходящим монетам в public/data/coins/*.json:
 *   node scripts/swap-austrian-mint-obv-rev-webp-files.js
 *   node scripts/swap-austrian-mint-obv-rev-webp-files.js --apply
 *
 * Условия (иначе пропуск в логе):
 * - mintCountry === «Австрия»
 * - в галерее > 1 кадра (imageUrls + imageUrl)
 * - пара austrian-mint-…-obv.webp и тот же stem …-rev.webp (URL с «blister» в имени не обрабатываются)
 * - id не в EXCLUDE_COIN_IDS (кроме режима --only-ids=…)
 *
 * Исключение: если скрипт монету не берёт (blister и т.п.) — тогда вручную обменять
 * два .webp на диске тем же тройным rename ИЛИ заменить файлы новыми экспортами;
 * править JSON/БД для смены сторон не обязательно, если пиксели лежат в «правильных» именах файлов.
 */
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const ROOT = path.join(__dirname, "..");
const COINS_DIR = path.join(ROOT, "public", "data", "coins");
const FOREIGN_DIR = path.join(ROOT, "public", "image", "coins", "foreign");

/** Не трогать эти id (список редактора). */
const EXCLUDE_COIN_IDS = new Set(
  [
    7270, 7284, 7271, 7232, 7308, 7376, 7265, 7229, 7360, 7302, 7285, 7383, 7377, 7384, 7286, 7362,
    7315,
    /** Ручной обмен obv+rev с диска (не трогать массовым swap) */
    7299,
  ].map(String)
);

function galleryUrls(coin) {
  const urls = (coin.imageUrls ?? []).filter(Boolean);
  const main = coin.imageUrl && String(coin.imageUrl).trim();
  if (urls.length === 0) return main ? [main] : [];
  if (main && !urls.includes(main)) return [main, ...urls];
  return urls;
}

function austrianStemFromUrl(u) {
  const s = String(u);
  if (!/austrian-mint-.+-obv\.webp$/i.test(s) && !/austrian-mint-.+-rev\.webp$/i.test(s)) return null;
  if (/blister/i.test(s)) return null;
  const m = s.match(/austrian-mint-(.+)-(obv|rev)\.webp$/i);
  return m ? m[1].toLowerCase() : null;
}

function basenameForeign(webPath) {
  if (!webPath || typeof webPath !== "string") return null;
  const idx = webPath.indexOf("/foreign/");
  if (idx === -1) return null;
  const rest = webPath.slice(idx + "/foreign/".length).split("/").pop();
  if (!rest || rest.includes("..")) return null;
  return rest;
}

function resolveObvRev(coin) {
  const urls = galleryUrls(coin);
  const roles = coin.imageUrlRoles;
  if (roles && roles.length === urls.length) {
    const oi = roles.indexOf("obverse");
    const ri = roles.indexOf("reverse");
    if (oi >= 0 && ri >= 0) {
      return { obv: urls[oi], rev: urls[ri] };
    }
  }
  const obv = urls.find((u) => /austrian-mint-.+-obv\.webp$/i.test(u) && !/blister/i.test(u));
  const rev = urls.find((u) => /austrian-mint-.+-rev\.webp$/i.test(u) && !/blister/i.test(u));
  if (!obv || !rev) return null;
  return { obv, rev };
}

/** @returns {Set<string> | null} */
function parseOnlyIdsArg() {
  const raw = process.argv.find((a) => a.startsWith("--only-ids="));
  if (!raw) return null;
  const part = raw.slice("--only-ids=".length).trim();
  const ids = part
    .split(/[,;\s]+/)
    .map((s) => String(s).trim())
    .filter(Boolean);
  if (!ids.length) {
    console.error("Укажите id: --only-ids=7299,7318");
    process.exit(1);
  }
  return new Set(ids);
}

function swapPair(obvBase, revBase, label, dryRun) {
  const obv = path.join(FOREIGN_DIR, obvBase);
  const rev = path.join(FOREIGN_DIR, revBase);
  if (!fs.existsSync(obv) || !fs.existsSync(rev)) {
    console.warn("Пропуск (нет файлов):", label, obvBase, revBase);
    return false;
  }
  if (dryRun) {
    console.log("[dry-run]", label, obvBase, "↔", revBase);
    return true;
  }
  const tmp = path.join(FOREIGN_DIR, `.swap-${crypto.randomBytes(8).toString("hex")}-${obvBase}`);
  fs.renameSync(obv, tmp);
  fs.renameSync(rev, obv);
  fs.renameSync(tmp, rev);
  console.log("OK:", label, obvBase, "↔", revBase);
  return true;
}

function main() {
  const dryRun = !process.argv.includes("--apply");
  const onlyIds = parseOnlyIdsArg();
  if (dryRun) console.log("Режим dry-run. Для обмена на диске добавьте --apply\n");
  if (onlyIds) console.log("Режим --only-ids, id:", [...onlyIds].join(", "), "\n");

  const files = fs.readdirSync(COINS_DIR).filter((f) => f.endsWith(".json"));
  let planned = 0;
  let skippedSingle = 0;
  let skippedExclude = 0;
  let skippedCountry = 0;
  let skippedNoPair = 0;
  let skippedStem = 0;

  for (const f of files) {
    let j;
    try {
      j = JSON.parse(fs.readFileSync(path.join(COINS_DIR, f), "utf8"));
    } catch {
      continue;
    }
    const coin = j.coin;
    if (!coin || !coin.id) continue;
    const id = String(coin.id);
    if (onlyIds) {
      if (!onlyIds.has(id)) continue;
    } else if (EXCLUDE_COIN_IDS.has(id)) {
      skippedExclude++;
      continue;
    }
    const country = String(coin.mintCountry ?? "").trim();
    if (country !== "Австрия") {
      skippedCountry++;
      continue;
    }
    const g = galleryUrls(coin);
    if (g.length <= 1) {
      skippedSingle++;
      continue;
    }
    const pair = resolveObvRev(coin);
    if (!pair) {
      skippedNoPair++;
      continue;
    }
    const so = austrianStemFromUrl(pair.obv);
    const sr = austrianStemFromUrl(pair.rev);
    if (!so || !sr || so !== sr) {
      skippedStem++;
      continue;
    }
    const bo = basenameForeign(pair.obv);
    const br = basenameForeign(pair.rev);
    if (!bo || !br || !/-obv\.webp$/i.test(bo) || !/-rev\.webp$/i.test(br)) {
      skippedNoPair++;
      continue;
    }
    if (swapPair(bo, br, `id=${id}`, dryRun)) planned++;
  }

  console.log(
    dryRun ? `\nИтого запланировано обменов: ${planned}` : `\nИтого обменено пар: ${planned}`
  );
  console.log(
    "Пропуски: exclude id:",
    skippedExclude,
    "| не Австрия:",
    skippedCountry,
    "| одна картинка:",
    skippedSingle,
    "| нет пары obv/rev:",
    skippedNoPair,
    "| разный stem:",
    skippedStem
  );
}

main();
