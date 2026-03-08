/**
 * Обновляет изображения ASE 2006: конвертирует добавленные PNG в WebP
 * и прописывает пути в БД для монет 2006 года.
 *
 * Запуск: node scripts/update-ase-2006-images.js
 */
require("dotenv").config({ path: ".env" });
const fs = require("fs");
const path = require("path");
const mysql = require("mysql2/promise");
const sharp = require("sharp");

const FOREIGN_DIR = path.join(__dirname, "..", "public", "image", "coins", "foreign");
const CATALOG_2006 = ["US-ASE-2006-BU", "US-ASE-2006-P-P", "US-ASE-2006-W-BU", "US-ASE-2006-W-P"];
const OBV_PNG = "American-Eagle-2006.png";
const REV_PNG = "American-Eagle-2006r.png";
const OBV_WEBP = "American-Eagle-2006.webp";
const REV_WEBP = "American-Eagle-2006r.webp";

async function main() {
  const obvPngPath = path.join(FOREIGN_DIR, OBV_PNG);
  const revPngPath = path.join(FOREIGN_DIR, REV_PNG);

  if (!fs.existsSync(obvPngPath) || !fs.existsSync(revPngPath)) {
    console.error("Не найдены:", OBV_PNG, "или", REV_PNG, "в", FOREIGN_DIR);
    process.exit(1);
  }

  console.log("Конвертация PNG → WebP...");
  await sharp(obvPngPath)
    .resize(1200, 1200, { fit: "inside", withoutEnlargement: true })
    .webp({ quality: 88 })
    .toFile(path.join(FOREIGN_DIR, OBV_WEBP));
  console.log("  ✓", OBV_WEBP);

  await sharp(revPngPath)
    .resize(1200, 1200, { fit: "inside", withoutEnlargement: true })
    .webp({ quality: 88 })
    .toFile(path.join(FOREIGN_DIR, REV_WEBP));
  console.log("  ✓", REV_WEBP);

  const url = process.env.DATABASE_URL;
  if (!url) {
    console.log("\nDATABASE_URL не задан — пропуск БД.");
    return;
  }
  const m = url.match(/mysql:\/\/([^:]+):([^@]+)@([^:]+):(\d+)\/(.+)/);
  if (!m) {
    console.log("Неверный формат DATABASE_URL.");
    return;
  }
  const [, user, password, host, port, database] = m;
  const conn = await mysql.createConnection({ host, port: parseInt(port, 10), user, password, database });

  const obvPath = "/image/coins/foreign/" + OBV_WEBP;
  const revPath = "/image/coins/foreign/" + REV_WEBP;

  const placeholders = CATALOG_2006.map(() => "?").join(", ");
  const [rows] = await conn.execute(
    `SELECT id, catalog_number FROM coins WHERE catalog_number IN (${placeholders})`,
    CATALOG_2006
  );

  for (const r of rows) {
    await conn.execute(
      `UPDATE coins SET image_obverse = ?, image_reverse = ? WHERE id = ?`,
      [obvPath, revPath, r.id]
    );
    console.log("  ✓", r.catalog_number, "→", OBV_WEBP);
  }

  await conn.end();
  console.log("\n✓ Обновлено:", rows.length, "монет ASE 2006");
  console.log("Дальше: npm run data:export && npm run build");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
