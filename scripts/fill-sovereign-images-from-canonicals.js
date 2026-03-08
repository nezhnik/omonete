/**
 * Заполняет image_obverse и image_reverse у монет с "Sovereign" в названии из каноников Perth (data/perth-mint-*.json).
 * Обновляются только записи, у которых оба поля пустые. Сопоставление по точному совпадению title.
 *
 * Запуск: node scripts/fill-sovereign-images-from-canonicals.js
 * С опцией --dry-run только вывод без UPDATE.
 */
require("dotenv").config({ path: ".env" });
const mysql = require("mysql2/promise");
const fs = require("fs");
const path = require("path");

const DATA_DIR = path.join(__dirname, "..", "data");

function getConfig() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL не задан");
  const m = url.match(/mysql:\/\/([^:]+):([^@]+)@([^:]+):(\d+)\/(.+)/);
  if (!m) throw new Error("Неверный формат DATABASE_URL");
  const [, user, password, host, port, database] = m;
  return { host, port: parseInt(port, 10), user, password, database };
}

function trim(s) {
  return s != null && String(s).trim() || "";
}

/** Загружаем каноники: title (нормализованный) → { image_obverse, image_reverse } */
function loadCanonicalByTitle() {
  const byTitle = new Map();
  if (!fs.existsSync(DATA_DIR)) return byTitle;
  const files = fs.readdirSync(DATA_DIR)
    .filter((f) => f.startsWith("perth-mint-") && f.endsWith(".json"))
    .map((f) => path.join(DATA_DIR, f));
  for (const fp of files) {
    let raw;
    try {
      raw = JSON.parse(fs.readFileSync(fp, "utf8"));
    } catch {
      continue;
    }
    const c = raw?.coin;
    if (!c?.title) continue;
    const title = trim(c.title);
    if (!title) continue;
    const obv = trim(c.image_obverse) || null;
    const rev = trim(c.image_reverse) || null;
    if (!obv && !rev) continue;
    if (!byTitle.has(title)) byTitle.set(title, { image_obverse: obv, image_reverse: rev });
    else {
      const cur = byTitle.get(title);
      if (obv && !cur.image_obverse) cur.image_obverse = obv;
      if (rev && !cur.image_reverse) cur.image_reverse = rev;
    }
  }
  return byTitle;
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  if (dryRun) console.log("Режим --dry-run: UPDATE не выполняется.\n");

  const canonicalByTitle = loadCanonicalByTitle();
  console.log("Каноников с хотя бы одним изображением (по title):", canonicalByTitle.size);

  const conn = await mysql.createConnection(getConfig());
  const [rows] = await conn.execute(
    `SELECT id, title, image_obverse, image_reverse FROM coins
     WHERE title LIKE '%Sovereign%'
       AND (image_obverse IS NULL OR TRIM(image_obverse) = '')
       AND (image_reverse IS NULL OR TRIM(image_reverse) = '')
     ORDER BY id`
  );

  console.log("Монет Sovereign в БД без картинок:", rows.length);

  let updated = 0;
  for (const r of rows) {
    const title = trim(r.title);
    if (!title) continue;
    const canon = canonicalByTitle.get(title);
    if (!canon || (!canon.image_obverse && !canon.image_reverse)) continue;
    const newObv = canon.image_obverse || r.image_obverse;
    const newRev = canon.image_reverse || r.image_reverse;
    if (dryRun) {
      console.log("  [dry-run] id=" + r.id + "  " + title.slice(0, 50));
      console.log("    image_obverse: " + (newObv || "(null)") + "  image_reverse: " + (newRev || "(null)"));
      updated++;
      continue;
    }
    await conn.execute(
      "UPDATE coins SET image_obverse = ?, image_reverse = ? WHERE id = ?",
      [newObv || null, newRev || null, r.id]
    );
    console.log("  id=" + r.id + "  " + title.slice(0, 55));
    updated++;
  }

  console.log("\nОбновлено записей:", updated);
  await conn.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
