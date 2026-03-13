/**
 * Применяет картинки из data/perth-compare/<id>/perth/ по всем id.
 * Если в perth 3 картинки (нет box) — у нас тоже 3: удаляем файл box из foreign и image_box в БД.
 * Запуск: node scripts/apply-all-perth-compare.js
 */
require("dotenv").config({ path: ".env" });
const fs = require("fs");
const path = require("path");
const sharp = require("sharp");
const mysql = require("mysql2/promise");

const ROOT = path.join(__dirname, "..");
const PERTH_COMPARE = path.join(ROOT, "data", "perth-compare");
const FOREIGN_DIR = path.join(ROOT, "public", "image", "coins", "foreign");
const MAX_SIDE = 1200;

const IDS = ["4429", "4432", "4541", "4542", "4424", "4757", "5762"];

async function main() {
  const idsWithoutBox = [];

  for (const id of IDS) {
    const perthDir = path.join(PERTH_COMPARE, id, "perth");
    if (!fs.existsSync(perthDir)) {
      console.warn("Пропуск id=" + id + ": нет папки perth");
      continue;
    }

    const files = fs.readdirSync(perthDir).filter((f) => /\.(jpg|jpeg|png|webp)$/i.test(f));
    if (files.length === 0) {
      console.warn("Пропуск id=" + id + ": пустая perth");
      continue;
    }

    const hasBox = files.some((f) => /-box\.(jpg|jpeg|png|webp)$/i.test(f));
    let basePrefix = null;

    for (const f of files) {
      const ext = path.extname(f).toLowerCase();
      const base = path.basename(f, ext);
      const src = path.join(perthDir, f);
      const dest = path.join(FOREIGN_DIR, base + ".webp");
      const buf = fs.readFileSync(src);
      await sharp(buf)
        .resize(MAX_SIDE, MAX_SIDE, { fit: "inside", withoutEnlargement: true })
        .webp({ quality: 82, effort: 6, smartSubsample: true })
        .toFile(dest);
      if (!basePrefix) basePrefix = base.replace(/-?(rev|obv|box|cert)$/i, "");
      console.log("OK id=" + id, base + ".webp");
    }

    if (!hasBox && basePrefix) {
      const boxPath = path.join(FOREIGN_DIR, basePrefix + "-box.webp");
      if (fs.existsSync(boxPath)) {
        fs.unlinkSync(boxPath);
        console.log("  удалён box (в perth нет):", path.basename(boxPath));
        idsWithoutBox.push(parseInt(id, 10));
      }
    }
  }

  if (idsWithoutBox.length === 0) {
    console.log("\nГотово. У всех монет в perth было 4 картинки, БД не меняем.");
    return;
  }

  const url = process.env.DATABASE_URL;
  if (!url) {
    console.log("\nГотово. Монет без box (id):", idsWithoutBox.join(", "));
    console.log("Запустите вручную: UPDATE coins SET image_box = NULL WHERE id IN (" + idsWithoutBox.join(",") + ");");
    return;
  }
  const m = url.match(/mysql:\/\/([^:]+):([^@]+)@([^:]+):(\d+)\/(.+)/);
  if (!m) {
    console.log("\nГотово. Для сброса box в БД выполните UPDATE вручную для id:", idsWithoutBox.join(", "));
    return;
  }
  const [, user, password, host, port, database] = m;
  const conn = await mysql.createConnection({ host, port: parseInt(port, 10), user, password, database });
  const placeholders = idsWithoutBox.map(() => "?").join(",");
  await conn.execute("UPDATE coins SET image_box = NULL WHERE id IN (" + placeholders + ")", idsWithoutBox);
  console.log("\n✓ В БД сброшен image_box для id:", idsWithoutBox.join(", "));
  await conn.end();
  console.log("Дальше: npm run data:export:incremental && npm run build");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
