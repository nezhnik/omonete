/**
 * Одноразово: скачать аверс для Dragon 2024 Gold и обновить каноник + БД.
 * URL из raw каноника (Perth Mint).
 */
require("dotenv").config({ path: ".env" });
const fs = require("fs");
const path = require("path");
const https = require("https");
const sharp = require("sharp");

const BASE = "https://www.perthmint.com";
const OBV_URL = BASE + "/globalassets/assets/product-images-e-com-pages/coins/01.-archive/2024/3s2415ddaa/02-2024-year-of-the-dragon-1oz--gold-proof-coin-obverse-highres.jpg?contextmode=Default?width=2000";
const FOREIGN_DIR = path.join(__dirname, "..", "public", "image", "coins", "foreign");
const FILE_SLUG = "australian-lunar-series-iii-2024-year-of-the-dragon-1oz-gold-proof-coloured-coin";
const CANONICAL_PATH = path.join(__dirname, "..", "data", `perth-mint-${FILE_SLUG}.json`);

function fetchBuffer(url) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = https.request(
      { hostname: u.hostname, path: u.pathname + u.search, method: "GET", headers: { "User-Agent": "Mozilla/5.0 Chrome/120.0.0.0" } },
      (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => resolve(Buffer.concat(chunks)));
      }
    );
    req.on("error", reject);
    req.end();
  });
}

async function main() {
  if (!fs.existsSync(FOREIGN_DIR)) fs.mkdirSync(FOREIGN_DIR, { recursive: true });
  const obvPath = path.join(FOREIGN_DIR, `${FILE_SLUG}-obv.webp`);
  console.log("Скачиваю аверс:", OBV_URL);
  const buf = await fetchBuffer(OBV_URL);
  if (buf.length < 1000) {
    console.error("Слишком маленький ответ");
    process.exit(1);
  }
  await sharp(buf)
    .resize(1200, 1200, { fit: "inside", withoutEnlargement: true })
    .webp({ quality: 82, effort: 6 })
    .toFile(obvPath);
  const relObv = "/image/coins/foreign/" + FILE_SLUG + "-obv.webp";
  console.log("Сохранено:", obvPath);

  const raw = JSON.parse(fs.readFileSync(CANONICAL_PATH, "utf8"));
  if (!raw.coin) throw new Error("Нет coin в канонике");
  raw.coin.image_obverse = relObv;
  if (raw.saved) raw.saved.obverse = relObv;
  fs.writeFileSync(CANONICAL_PATH, JSON.stringify(raw, null, 2));
  console.log("Каноник обновлён:", CANONICAL_PATH);

  const mysql = require("mysql2/promise");
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.log("DATABASE_URL не задан — БД не обновлялась. Запусти update-perth-from-canonical-json.js.");
    return;
  }
  const m = url.match(/mysql:\/\/([^:]+):([^@]+)@([^:]+):(\d+)\/(.+)/);
  if (!m) return;
  const [, user, password, host, port, database] = m;
  const conn = await mysql.createConnection({ host, port: parseInt(port, 10), user, password, database });
  const [rows] = await conn.execute(
    "SELECT id FROM coins WHERE catalog_suffix LIKE ? OR source_url LIKE ?",
    ["%3s2536da%", "%australian-lunar-series-iii-2024-year-of-the-dragon-1oz-gold-proof-coloured-coin%"]
  );
  if (rows.length > 0) {
    await conn.execute("UPDATE coins SET image_obverse = ? WHERE id = ?", [relObv, rows[0].id]);
    console.log("БД обновлена, id:", rows[0].id);
  }
  await conn.end();
  console.log("Готово. Дальше: node scripts/export-coins-to-json.js");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
