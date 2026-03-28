/**
 * Удаляет локальные webp Mennica (obv/rev), чтобы обычный import снова скачал файлы.
 * По умолчанию только **план (dry-run)** — ничего не удаляет.
 *
 * Предпочтительный безопасный путь без rm: `npm run mennica:import -- --force-images`
 * (перекачка по URL из JSON, атомарная запись, при ошибке старый файл остаётся).
 *
 *   node scripts/refresh-mennica-foreign-webp.js --same-hash
 *   node scripts/refresh-mennica-foreign-webp.js --same-hash --apply
 *   node scripts/refresh-mennica-foreign-webp.js --same-hash --apply --backup
 *   node scripts/refresh-mennica-foreign-webp.js 7073 7059 --apply [--backup]
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

function ensureBackupDir() {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const dir = path.join(ROOT, "public", "image", "coins", `mennica-webp-backup-${stamp}`);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function backupIfNeeded(backupRoot, fp) {
  if (!backupRoot || !fs.existsSync(fp)) return;
  const name = path.basename(fp);
  fs.copyFileSync(fp, path.join(backupRoot, name));
}

function deletePair(slug, { dryRun, backupRoot }) {
  const bases = [`mennica-${slug}-obv.webp`, `mennica-${slug}-rev.webp`];
  let n = 0;
  for (const name of bases) {
    const fp = path.join(FOREIGN_DIR, name);
    if (!fs.existsSync(fp)) continue;
    if (dryRun) {
      console.log("[dry-run] удалить бы:", fp);
      n++;
      continue;
    }
    if (backupRoot) backupIfNeeded(backupRoot, fp);
    fs.unlinkSync(fp);
    console.log("удалено", fp);
    n++;
  }
  return n;
}

function refreshByCoinIds(ids, opts) {
  let n = 0;
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
    n += deletePair(slug, opts);
  }
  return n;
}

function listSameHashSlugs() {
  const files = fs.readdirSync(DATA_DIR).filter((f) => f.startsWith("mennica-") && f.endsWith(".json") && !f.includes("listing"));
  const slugs = [];
  for (const f of files) {
    const slug = f.replace(/^mennica-/, "").replace(/\.json$/, "");
    let raw;
    try {
      raw = JSON.parse(fs.readFileSync(path.join(DATA_DIR, f), "utf8"));
    } catch {
      continue;
    }
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
    if (ho && hr && ho === hr) slugs.push(slug);
  }
  return slugs;
}

function refreshSameHashAll(opts) {
  const slugs = listSameHashSlugs();
  if (!slugs.length) {
    console.log("Нет slug с разными URL в JSON и одинаковым SHA256 у obv/rev на диске.");
    return 0;
  }
  console.log(opts.dryRun ? "План (dry-run), slug:" : "Удаление пар obv/rev, slug:", slugs.join(", "));
  let total = 0;
  for (const slug of slugs) {
    total += deletePair(slug, opts);
  }
  return total;
}

function printHelp() {
  console.log(`
Безопасная перекачка картинок Mennica (рекомендуется):
  npm run mennica:import -- --force-images
  npm run data:export:incremental

Этот скрипт — только удаление obv/rev webp (по умолчанию dry-run):
  node scripts/refresh-mennica-foreign-webp.js --same-hash
  node scripts/refresh-mennica-foreign-webp.js --same-hash --apply [--backup]
  node scripts/refresh-mennica-foreign-webp.js 7073 7059 --apply [--backup]

  --apply    реально удалить файлы
  --backup   перед удалением копия в public/image/coins/mennica-webp-backup-<время>/
`);
}

function main() {
  const argv = process.argv.slice(2);
  if (argv.includes("--help") || argv.includes("-h")) {
    printHelp();
    return;
  }

  const apply = argv.includes("--apply");
  const backup = argv.includes("--backup");
  const dryRun = !apply;

  if (dryRun) {
    console.log("Режим dry-run (ничего не удалено). Для удаления добавьте --apply.\n");
  }

  let backupRoot = null;
  if (apply && backup) {
    backupRoot = ensureBackupDir();
    console.log("Резервная копия удаляемых файлов:", backupRoot, "\n");
  }

  const opts = { dryRun, backupRoot };

  if (argv.includes("--same-hash")) {
    refreshSameHashAll(opts);
    console.log(
      apply
        ? "\nДалее: npm run mennica:import  (или сразу с перекачкой: npm run mennica:import -- --force-images)"
        : "\nДля выполнения: добавьте --apply. Либо без rm: npm run mennica:import -- --force-images"
    );
    return;
  }

  const ids = argv.filter((a) => /^\d+$/.test(a));
  if (!ids.length) {
    printHelp();
    process.exit(1);
  }
  refreshByCoinIds(ids, opts);
  console.log(
    apply
      ? "\nДалее: npm run mennica:import && npm run data:export:incremental"
      : "\nДля удаления: повторите с --apply. Или: npm run mennica:import -- --force-images"
  );
}

main();
