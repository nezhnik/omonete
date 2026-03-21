/**
 * Папка data/perth-compare/<id>/perth/ — эталон: заменяет картинки монеты целиком.
 * - Удаляет старые файлы из public/image/coins/foreign/ по путям из public/data/coins/<id>.json
 * - Конвертирует все jpg/png/webp из perth/ в webp с именами {prefix}-{rev|obv|box|cert}.webp
 * - Префикс slug берётся из текущего JSON монеты (до -rev/-obv/-box/-cert)
 * - Роли из имён файлов (см. inferRole); лишние колонки в БД = NULL
 * - image_urls обнуляется
 *
 * Запуск: node scripts/apply-perth-folder-as-canonical.js [id1 id2 ...]
 * По умолчанию id: 4611 5335 5065 5837
 */
require("dotenv").config({ path: ".env" });
const fs = require("fs");
const path = require("path");
const sharp = require("sharp");
const mysql = require("mysql2/promise");

const ROOT = path.join(__dirname, "..");
const PUBLIC = path.join(ROOT, "public");
const FOREIGN_DIR = path.join(PUBLIC, "image", "coins", "foreign");
const COINS_JSON_DIR = path.join(PUBLIC, "data", "coins");
const PERTH_COMPARE = path.join(ROOT, "data", "perth-compare");
const MAX_SIDE = 1200;

const DEFAULT_IDS = ["4611", "5335", "5065", "5837"];

/** Роль для колонки БД и суффикса файла */
const ROLE_SUFFIX = {
  reverse: "rev",
  obverse: "obv",
  box: "box",
  certificate: "cert",
};

/**
 * Определяет роль по имени файла (без учёта регистра).
 * Порядок важен: сначала однозначные маркеры.
 */
function inferRole(basenameNoExt) {
  const b = basenameNoExt.toLowerCase();
  if (/-cert$|certificate|inshipper/i.test(b)) return "certificate";
  if (/-box$/i.test(b)) return "box";
  if (/-obv$|_obv$|obverse/i.test(b)) return "obverse";
  if (/-rev$|_rev$|incase-rev|straighton/i.test(b)) return "reverse";
  if (/incase/i.test(b) && !/-rev$/i.test(b) && !/incase-rev/i.test(b)) return "box";
  return null;
}

function extractPrefixFromCoin(coin) {
  const urls = [coin.imageUrl, ...(Array.isArray(coin.imageUrls) ? coin.imageUrls : [])].filter(Boolean);
  for (const u of urls) {
    const m = String(u).match(/\/image\/coins\/foreign\/(.+)-(rev|obv|box|cert)\.webp$/i);
    if (m) return m[1];
  }
  throw new Error("Не удалось вычислить префикс slug из imageUrl/imageUrls");
}

function publicPathToFs(rel) {
  const p = rel.startsWith("/") ? rel.slice(1) : rel;
  return path.join(PUBLIC, p);
}

function deleteOldCoinImages(coin) {
  const urls = new Set(
    [coin.imageUrl, ...(Array.isArray(coin.imageUrls) ? coin.imageUrls : [])].filter(Boolean)
  );
  for (const rel of urls) {
    if (!String(rel).includes("/image/coins/foreign/")) continue;
    const fsPath = publicPathToFs(rel);
    if (fs.existsSync(fsPath)) {
      fs.unlinkSync(fsPath);
      console.log("  удалён старый:", path.basename(fsPath));
    }
  }
}

async function processOneCoin(coinId) {
  const coinJsonPath = path.join(COINS_JSON_DIR, `${coinId}.json`);
  if (!fs.existsSync(coinJsonPath)) throw new Error(`Нет ${coinJsonPath}`);
  const raw = JSON.parse(fs.readFileSync(coinJsonPath, "utf8"));
  const coin = raw.coin;
  if (!coin) throw new Error(`Нет coin в ${coinId}.json`);

  const prefix = extractPrefixFromCoin(coin);
  const perthDir = path.join(PERTH_COMPARE, coinId, "perth");
  if (!fs.existsSync(perthDir)) throw new Error(`Нет папки ${perthDir}`);

  const files = fs
    .readdirSync(perthDir)
    .filter((f) => /\.(jpg|jpeg|png|webp)$/i.test(f))
    .sort();
  if (files.length === 0) throw new Error(`Пустая perth для id=${coinId}`);

  const byRole = {};
  for (const f of files) {
    const ext = path.extname(f);
    const base = path.basename(f, ext);
    const role = inferRole(base);
    if (!role) throw new Error(`id=${coinId}: неизвестная роль для файла "${f}"`);
    if (byRole[role]) throw new Error(`id=${coinId}: дубль роли "${role}" (${byRole[role].file} и ${f})`);
    byRole[role] = { file: f, base };
  }

  console.log(`\nid=${coinId} prefix=${prefix} файлов=${files.length} роли=${Object.keys(byRole).join(", ")}`);

  deleteOldCoinImages(coin);

  const paths = {
    obverse: null,
    reverse: null,
    box: null,
    certificate: null,
  };

  for (const role of Object.keys(byRole)) {
    const { file } = byRole[role];
    const suf = ROLE_SUFFIX[role];
    const destBase = `${prefix}-${suf}.webp`;
    const dest = path.join(FOREIGN_DIR, destBase);
    const src = path.join(perthDir, file);
    const buf = fs.readFileSync(src);
    await sharp(buf)
      .resize(MAX_SIDE, MAX_SIDE, { fit: "inside", withoutEnlargement: true })
      .webp({ quality: 82, effort: 6, smartSubsample: true })
      .toFile(dest);
    paths[role] = `/image/coins/foreign/${destBase}`;
    console.log("  →", destBase, "←", file);
  }

  return paths;
}

async function main() {
  const ids = process.argv.slice(2).filter(Boolean);
  const IDS = ids.length ? ids : DEFAULT_IDS;

  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("Нужен DATABASE_URL в .env");
    process.exit(1);
  }
  const m = url.match(/mysql:\/\/([^:]+):([^@]+)@([^:]+):(\d+)\/(.+)/);
  if (!m) {
    console.error("Неверный формат DATABASE_URL");
    process.exit(1);
  }
  const [, user, password, host, port, database] = m;
  const conn = await mysql.createConnection({ host, port: parseInt(port, 10), user, password, database });

  for (const id of IDS) {
    const paths = await processOneCoin(id);
    await conn.execute(
      `UPDATE coins SET
        image_obverse = ?,
        image_reverse = ?,
        image_box = ?,
        image_certificate = ?,
        image_urls = NULL
      WHERE id = ?`,
      [paths.obverse, paths.reverse, paths.box, paths.certificate, parseInt(id, 10)]
    );
    console.log("  ✓ БД обновлена для id=", id);
  }

  await conn.end();
  console.log("\nГотово. Дальше: npm run data:export:incremental");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
