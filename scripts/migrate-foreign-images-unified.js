/**
 * Миграция: все /image/coins/foreign/* → единая схема {slug}-{role}.webp
 * Вложенные royalduch/scottsdale/…/01.png и плоские имена приводятся к одному виду.
 *
 * node scripts/migrate-foreign-images-unified.js --dry-run   (по умолчанию)
 * node scripts/migrate-foreign-images-unified.js --apply
 */
require("dotenv").config({ path: ".env" });
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const mysql = require("mysql2/promise");
const sharp = require("sharp");
const { PREFIX, legacyToUnifiedUrl } = require("./lib/unified-foreign-image.js");

const ROOT = path.join(__dirname, "..");
const FOREIGN = path.join(ROOT, "public", "image", "coins", "foreign");
const MAX_SIDE = 1200;
const WEBP_OPTS = { quality: 82, effort: 6, smartSubsample: true };

const APPLY = process.argv.includes("--apply");
const DRY = !APPLY;
if (DRY) console.log("Режим --dry-run. Для применения добавьте --apply\n");

const IMAGE_COLS = [
  "image_obverse",
  "image_reverse",
  "image_blister_reverse",
  "image_blister_obverse",
  "image_packaging",
  "image_box",
  "image_certificate",
];

function getConn() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL");
  const m = url.match(/mysql:\/\/([^:]+):([^@]+)@([^:]+):(\d+)\/(.+)/);
  if (!m) throw new Error("Неверный DATABASE_URL");
  const [, user, password, host, port, database] = m;
  return mysql.createConnection({ host, port: Number(port), user, password, database });
}

function absFromPublicUrl(u) {
  const p = String(u || "")
    .trim()
    .split("?")[0];
  if (!p.startsWith("/image/")) return null;
  return path.join(ROOT, "public", p.replace(/^\//, ""));
}

function hashFile(p) {
  try {
    const buf = fs.readFileSync(p);
    return crypto.createHash("sha256").update(buf).digest("hex");
  } catch {
    return null;
  }
}

async function encodeToWebp(srcAbs, dstAbs) {
  const lower = srcAbs.toLowerCase();
  const buf = await fs.promises.readFile(srcAbs);
  if (lower.endsWith(".webp")) {
    await fs.promises.writeFile(dstAbs, buf);
    return;
  }
  const out = await sharp(buf)
    .resize(MAX_SIDE, MAX_SIDE, { fit: "inside", withoutEnlargement: true })
    .webp(WEBP_OPTS)
    .toBuffer();
  await fs.promises.writeFile(dstAbs, out);
}

function collectUrlsFromRow(row) {
  const set = new Set();
  for (const c of IMAGE_COLS) {
    const v = row[c];
    if (v != null && String(v).trim()) set.add(String(v).trim().split("?")[0]);
  }
  let arr = row.image_urls;
  if (arr == null || arr === "") return set;
  try {
    const p = typeof arr === "string" ? JSON.parse(arr) : arr;
    if (Array.isArray(p)) for (const u of p) if (u) set.add(String(u).trim().split("?")[0]);
  } catch {
    /* empty */
  }
  return set;
}

function replaceUrlsInRow(row, mapRepl) {
  const pairs = [...mapRepl.entries()].sort((a, b) => b[0].length - a[0].length);
  const applyStr = (s) => {
    if (s == null || s === "") return s;
    let o = String(s).trim();
    for (const [from, to] of pairs) {
      if (o.includes(from)) o = o.split(from).join(to);
    }
    return o;
  };

  const out = { id: row.id, sets: [], vals: [] };
  for (const c of IMAGE_COLS) {
    const v = row[c];
    if (v == null || v === "") continue;
    const n = applyStr(v);
    if (n !== String(v).trim()) {
      out.sets.push(`${c} = ?`);
      out.vals.push(n);
    }
  }

  let urlsRaw = row.image_urls;
  if (urlsRaw != null && urlsRaw !== "") {
    try {
      const arr = typeof urlsRaw === "string" ? JSON.parse(urlsRaw) : urlsRaw;
      if (Array.isArray(arr)) {
        const next = arr.map((u) => applyStr(String(u).trim()));
        if (JSON.stringify(next) !== JSON.stringify(arr)) {
          out.sets.push("image_urls = ?");
          out.vals.push(JSON.stringify(next));
        }
      }
    } catch {
      /* empty */
    }
  }

  if (out.sets.length > 0) {
    out.vals.push(row.id);
    return out;
  }
  return null;
}

function pruneEmptyDirs(dir) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    if (e.isDirectory()) pruneEmptyDirs(path.join(dir, e.name));
  }
  try {
    if (dir !== FOREIGN && fs.readdirSync(dir).length === 0) fs.rmdirSync(dir);
  } catch {
    /* empty */
  }
}

async function main() {
  const conn = await getConn();
  const [rows] = await conn.execute(
    `SELECT id, ${IMAGE_COLS.join(", ")}, image_urls FROM coins`
  );

  /** @type {Map<string, string>} */
  const urlMap = new Map();
  /** @type {Map<string, Set<string>>} */
  const inverse = new Map();

  let foreignCount = 0;
  for (const row of rows) {
    for (const u of collectUrlsFromRow(row)) {
      if (!u.startsWith(PREFIX)) continue;
      foreignCount++;
      const nu = legacyToUnifiedUrl(u);
      if (!nu) {
        console.error("Не разобрать URL:", u, "coin", row.id);
        process.exitCode = 1;
        continue;
      }
      if (!urlMap.has(u)) urlMap.set(u, nu);
      else if (urlMap.get(u) !== nu) {
        console.error("Противоречие mapping для", u);
        process.exitCode = 1;
      }
      if (!inverse.has(nu)) inverse.set(nu, new Set());
      inverse.get(nu).add(u);
    }
  }

  /** Без файла на диске — не трогаем БД (избегаем 404). */
  const urlMapApply = new Map(urlMap);
  for (const [oldU] of urlMap) {
    const src = absFromPublicUrl(oldU);
    if (!src || !fs.existsSync(src)) urlMapApply.delete(oldU);
  }
  const skipMissing = urlMap.size - urlMapApply.size;
  if (skipMissing) console.warn("Пропуск (нет файла), ссылки в БД не меняем:", skipMissing, "URL");

  for (const [nu, olds] of inverse) {
    if (olds.size <= 1) continue;
    const hashes = new Set();
    for (const o of olds) {
      const a = absFromPublicUrl(o);
      if (a && fs.existsSync(a)) hashes.add(hashFile(a));
      else hashes.add(null);
    }
    const real = [...hashes].filter(Boolean);
    if (real.length > 1) {
      console.error("КОЛЛИЗИЯ целевого URL (разные файлы):", nu, "из", [...olds]);
      process.exitCode = 1;
    }
  }

  console.log("Упоминаний foreign URL в БД:", foreignCount);
  console.log("Уникальных legacy URL:", urlMap.size);
  console.log("Уникальных целевых URL:", inverse.size);

  let missing = 0;
  /** @type {Map<string, string>} dstAbs -> srcAbs */
  const targetToSource = new Map();
  for (const [oldU, newU] of urlMapApply) {
    const src = absFromPublicUrl(oldU);
    const dst = absFromPublicUrl(newU);
    if (!src || !dst) continue;
    if (!fs.existsSync(src)) {
      missing++;
      console.warn("Нет файла на диске:", oldU);
      continue;
    }
    if (!targetToSource.has(dst)) targetToSource.set(dst, src);
  }
  console.log("Уникальных целевых файлов на диске:", targetToSource.size);
  console.log("Отсутствуют исходные файлы (ссылки в БД):", missing);

  if (DRY) {
    console.log("\nПримеры mapping:");
    let i = 0;
    for (const [o, n] of urlMap) {
      if (o === n) continue;
      console.log(o, "→", n);
      if (++i >= 12) break;
    }
    await conn.end();
    process.exit(process.exitCode || 0);
  }

  for (const [dstAbs, srcAbs] of targetToSource) {
    await fs.promises.mkdir(path.dirname(dstAbs), { recursive: true });
    if (path.resolve(srcAbs) === path.resolve(dstAbs) && srcAbs.toLowerCase().endsWith(".webp")) continue;
    await encodeToWebp(srcAbs, dstAbs);
    console.log("✓", path.relative(path.join(ROOT, "public"), dstAbs).replace(/\\/g, "/"));
  }

  for (const [oldU, newU] of urlMapApply) {
    const src = absFromPublicUrl(oldU);
    const dst = absFromPublicUrl(newU);
    if (!src || !fs.existsSync(src)) continue;
    if (path.resolve(src) === path.resolve(dst)) continue;
    try {
      fs.unlinkSync(src);
    } catch {
      /* empty */
    }
  }

  pruneEmptyDirs(FOREIGN);

  let updated = 0;
  for (const row of rows) {
    const patch = replaceUrlsInRow(row, urlMapApply);
    if (patch) {
      await conn.execute(`UPDATE coins SET ${patch.sets.join(", ")} WHERE id = ?`, patch.vals);
      updated++;
    }
  }
  await conn.end();
  console.log("\nОбновлено строк coins:", updated);
  console.log("Запустите: npm run data:export:incremental");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
