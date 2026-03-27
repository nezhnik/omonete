/**
 * Номинал 2 доллара (Тувалу) для перечня внутренних id монет на сайте.
 * Пишет specs.Denomination в data/pamp-collectible-*.json (чтобы pamp:import не затирал)
 * и обновляет face_value в БД.
 *
 *   node scripts/pamp-backfill-face-tuvalu-2usd-coin-ids.js
 *   npm run data:export:incremental
 */
require("dotenv").config({ path: ".env" });
const fs = require("fs");
const path = require("path");
const mysql = require("mysql2/promise");
const { formatDenominationForFaceValue } = require("./format-coin-characteristics.js");

const ROOT = path.join(__dirname, "..");
const DATA_DIR = path.join(ROOT, "data");
const COINS_EXPORT_DIR = path.join(ROOT, "public", "data", "coins");

/** Список от редактора каталога (PAMP collectibles, законный платёж Тувалу 2$). */
const COIN_IDS = [
  6762, 6763, 6853, 6831, 6830, 6805, 6828, 6827, 6818, 6817, 6798, 6765, 6764, 6760, 6759, 6877, 6852, 6820, 6812,
  6811, 6809, 6772, 6800, 6801, 6878, 6876, 6875, 6874, 6850, 6851, 6837, 6836, 6832, 6833, 6834, 6835, 6816, 6821,
  6822, 6823, 6799, 6814, 6815, 6793, 6792, 6791, 6788, 6761, 6755,
];

const FACE = formatDenominationForFaceValue(2, "Тувалу");

function getConfig() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL не задан");
  const m = url.match(/mysql:\/\/([^:]+):([^@]+)@([^:]+):(\d+)\/(.+)/);
  if (!m) throw new Error("Неверный формат DATABASE_URL");
  const [, user, password, host, port, database] = m;
  return { host, port: Number(port), user, password, database };
}

function slugFromExportedImageUrl(url) {
  const m = String(url || "").match(/\/foreign\/(.+)\.webp$/i);
  if (!m) return null;
  let base = m[1];
  for (const suf of ["-blister-obv", "-blister-rev", "-obv", "-rev", "-certificate", "-box", "-packaging"]) {
    if (base.endsWith(suf)) return base.slice(0, -suf.length);
  }
  return base;
}

async function main() {
  let jsonUpdated = 0;
  const missingJson = [];
  const missingSlug = [];
  for (const id of COIN_IDS) {
    const jf = path.join(COINS_EXPORT_DIR, `${id}.json`);
    if (!fs.existsSync(jf)) {
      missingJson.push(id);
      continue;
    }
    const payload = JSON.parse(fs.readFileSync(jf, "utf8"));
    const img = payload.coin && payload.coin.imageUrl;
    const slug = slugFromExportedImageUrl(img);
    if (!slug) {
      missingSlug.push(id);
      continue;
    }
    const pampPath = path.join(DATA_DIR, `pamp-collectible-${slug}.json`);
    if (!fs.existsSync(pampPath)) {
      console.warn("Нет data/pamp-collectible-" + slug + ".json (id " + id + ")");
      continue;
    }
    const raw = JSON.parse(fs.readFileSync(pampPath, "utf8"));
    if (!raw.specs || typeof raw.specs !== "object") raw.specs = {};
    if (raw.specs.Denomination !== FACE) {
      raw.specs.Denomination = FACE;
      fs.writeFileSync(pampPath, JSON.stringify(raw, null, 2), "utf8");
      jsonUpdated++;
    }
  }
  if (missingJson.length) console.warn("Нет public/data/coins/*.json для id:", missingJson.join(", "));
  if (missingSlug.length) console.warn("Не удалось вывести slug из imageUrl:", missingSlug.join(", "));
  console.log("Обновлено pamp-collectible-*.json (Denomination):", jsonUpdated);
  console.log("Номинал:", FACE);

  const cfg = getConfig();
  const conn = await mysql.createConnection(cfg);
  try {
    const placeholders = COIN_IDS.map(() => "?").join(",");
    const [res] = await conn.execute(
      `UPDATE coins SET face_value = ? WHERE id IN (${placeholders}) AND source_url IS NOT NULL AND source_url LIKE ?`,
      [FACE, ...COIN_IDS, "%pamp.com%"]
    );
    console.log("БД coins.face_value, затронуто строк:", res.affectedRows);
  } finally {
    await conn.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
