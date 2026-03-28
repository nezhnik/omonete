/**
 * Удаляет локальные webp Mennica для монет, чтобы import-mennica-to-db.js снова скачал
 * картинки по URL из data/mennica-<slug>.json (иначе localizeForeignImage пропускает существующий файл).
 *
 * Симптом: в каталоге разные пути …-obv.webp и …-rev.webp, но файлы на диске одинаковые по содержимому
 * (старый импорт при дубле URL или после правки JSON без удаления файлов).
 *
 *   node scripts/refresh-mennica-foreign-webp.js 7073 7082 7059
 *   node scripts/refresh-mennica-foreign-webp.js --same-hash   — все slug, где в JSON разные каноны obv/rev, а obv/rev webp на диске с одинаковым SHA256
 */
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const ROOT = path.join(__dirname, "..");
const COINS_DIR = path.join(ROOT, "public", "data", "coins");
const DATA_DIR = path.join(ROOT, "data");
const FOREIGN_DIR = path.join(ROOT, "public", "image", "coins", "foreign");

function normalizeMennicaImgCanon(u) {
  if (!u || typeof u !== "string") return "";
  return u.split("?")[0].toLowerCase().replace(/-\d+x\d+(?=\.[^.]+)/gi, "");
}

function mennicaSlugFromDetailCoin(coin) {
  const u = coin?.imageUrl || "";
  const m = String(u).match(/\/mennica-(.+?)-(obv|rev)\.webp$/i);
  return m ? m[1] : null;
}

function sha256file(fp) {
  try {
    const b = fs.readFileSync(fp);
    return crypto.createHash("sha256").update(b).digest("hex");
  } catch {
    return null;
  }
}

function deletePair(slug) {
  const bases = [`mennica-${slug}-obv.webp`, `mennica-${slug}-rev.webp`];
  let n = 0;
  for (const name of bases) {
    const fp = path.join(FOREIGN_DIR, name);
    if (fs.existsSync(fp)) {
      fs.unlinkSync(fp);
      console.log("удалено", fp);
      n++;
    }
  }
  return n;
}

function refreshByCoinIds(ids) {
  for (const id of ids) {
    const fp = path.join(COINS_DIR, `${id}.json`);
    if (!fs.existsSync(fp)) {
      console.warn("нет детального JSON:", id);
      continue;
    }
    let j;
    try {
      j = JSON.parse(fs.readFileSync(fp, "utf8"));
    } catch (e) {
      console.warn("битый JSON", id, e.message);
      continue;
    }
    const slug = mennicaSlugFromDetailCoin(j.coin);
    if (!slug) {
      console.warn("не Mennica или нет imageUrl obv:", id);
      continue;
    }
    const dataPath = path.join(DATA_DIR, `mennica-${slug}.json`);
    if (!fs.existsSync(dataPath)) {
      console.warn("нет data/mennica-", slug, ".json — пропуск", id);
      continue;
    }
    deletePair(slug);
  }
}

function refreshSameHashAll() {
  const files = fs.readdirSync(DATA_DIR).filter((f) => f.startsWith("mennica-") && f.endsWith(".json") && !f.includes("listing"));
  let total = 0;
  for (const f of files) {
    const slug = f.replace(/^mennica-/, "").replace(/\.json$/, "");
    const raw = JSON.parse(fs.readFileSync(path.join(DATA_DIR, f), "utf8"));
    const o = raw?.classified?.obverse;
    const r = raw?.classified?.reverse;
    if (!o || !r || !/^https?:\/\//i.test(o) || !/^https?:\/\//i.test(r)) continue;
    const co = normalizeMennicaImgCanon(o);
    const cr = normalizeMennicaImgCanon(r);
    if (co === cr) continue;
    const ob = path.join(FOREIGN_DIR, `mennica-${slug}-obv.webp`);
    const rev = path.join(FOREIGN_DIR, `mennica-${slug}-rev.webp`);
    if (!fs.existsSync(ob) || !fs.existsSync(rev)) continue;
    const ho = sha256file(ob);
    const hr = sha256file(rev);
    if (ho && hr && ho === hr) {
      console.log("одинаковый хэш obv/rev:", slug);
      total += deletePair(slug);
    }
  }
  console.log("готово, удалено файлов (пар): проверьте лог выше");
}

function main() {
  const argv = process.argv.slice(2);
  if (argv.includes("--same-hash")) {
    refreshSameHashAll();
    console.log("\nДалее: npm run mennica:import && npm run data:export:incremental");
    return;
  }
  const ids = argv.filter((a) => /^\d+$/.test(a));
  if (!ids.length) {
    console.error("Укажите id монет: node scripts/refresh-mennica-foreign-webp.js 7073 7082 …\nили: node scripts/refresh-mennica-foreign-webp.js --same-hash");
    process.exit(1);
  }
  refreshByCoinIds(ids);
  console.log("\nДалее: npm run mennica:import && npm run data:export:incremental");
}

main();
