/**
 * Разделяет монеты «с двумя дворами» на отдельные записи: одна запись = один двор.
 * Находит все coins, у которых mint_short содержит запятую (например "ММД, СПМД"),
 * оставляет первую запись за первый двор (обновляет mint, catalog_number, title),
 * для каждого остального двора вставляет новую строку.
 *
 * Результат: у каждой монеты отдельная страница с одним двором, без «два двора» в интерфейсе.
 *
 * Запуск: node scripts/split-two-mints-to-separate-coins.js [--dry-run]
 */
require("dotenv").config({ path: ".env" });
const mysql = require("mysql2/promise");
const path = require("path");

const MINT_SHORT_TO_FULL = {
  ММД: "Московский монетный двор",
  СПМД: "Санкт-Петербургский монетный двор",
  ЛМД: "Ленинградский монетный двор",
};

const COIN_COLS =
  "title, series, country, face_value, release_date, image_urls, catalog_number, catalog_suffix, image_obverse, image_reverse, image_box, image_certificate, mint, mint_short, metal, metal_fineness, mintage, mintage_display, weight_g, weight_oz, quality, diameter_mm, thickness_mm, length_mm, width_mm".split(
    ", "
  );

function parseMints(mintShort) {
  if (!mintShort || typeof mintShort !== "string") return [];
  return mintShort
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function baseTitle(title) {
  if (!title || typeof title !== "string") return title || "";
  return title.replace(/\s*\([МСЛ][МПД]+\)\s*$/i, "").trim();
}

function titleWithMint(base, short) {
  return `${base} (${short})`;
}

async function run() {
  const dryRun = process.argv.includes("--dry-run");
  if (dryRun) console.log("Режим --dry-run: изменения не применяются.\n");

  require("dotenv").config({ path: path.join(__dirname, "..", ".env") });
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL не задан в .env");
    process.exit(1);
  }
  const m = url.match(/mysql:\/\/([^:]+):([^@]+)@([^:]+):(\d+)\/(.+)/);
  if (!m) {
    console.error("Неверный формат DATABASE_URL");
    process.exit(1);
  }
  const [, user, password, host, port, database] = m;
  const conn = await mysql.createConnection({
    host,
    port: parseInt(port, 10),
    user,
    password,
    database,
  });

  const [rows] = await conn.execute(
    `SELECT id, ${COIN_COLS.join(", ")} FROM coins WHERE mint_short LIKE ?`,
    ["%,%"]
  );

  if (rows.length === 0) {
    console.log("Монет с двумя дворами (mint_short через запятую) не найдено.");
    await conn.end();
    return;
  }

  console.log("Найдено монет с двумя дворами:", rows.length, "\n");

  for (const row of rows) {
    const mints = parseMints(row.mint_short);
    if (mints.length < 2) {
      console.warn("  Пропуск id", row.id, ": только один двор после разбора:", row.mint_short);
      continue;
    }
    const baseCat = (row.catalog_number || "").trim();
    const baseT = baseTitle(row.title);

    for (const short of mints) {
      const full = MINT_SHORT_TO_FULL[short];
      if (!full) {
        console.warn("  Неизвестный двор «" + short + "» для id", row.id);
        continue;
      }
    }

    const firstShort = mints[0];
    const firstFull = MINT_SHORT_TO_FULL[firstShort];
    const newCatalogFirst = baseCat + "-" + firstShort;
    const newTitleFirst = titleWithMint(baseT, firstShort);

    console.log("  id", row.id, "|", row.title, "|", row.mint_short);
    console.log("    → оставляем запись: двор", firstShort, ", каталог", newCatalogFirst, ", название", newTitleFirst);

    if (!dryRun) {
      await conn.execute(
        `UPDATE coins SET mint = ?, mint_short = ?, catalog_number = ?, title = ? WHERE id = ?`,
        [firstFull, firstShort, newCatalogFirst, newTitleFirst, row.id]
      );
    }

    for (let i = 1; i < mints.length; i++) {
      const short = mints[i];
      const full = MINT_SHORT_TO_FULL[short];
      const newCatalog = baseCat + "-" + short;
      const newTitle = titleWithMint(baseT, short);
      console.log("    → новая запись: двор", short, ", каталог", newCatalog, ", название", newTitle);

      if (!dryRun) {
        const vals = COIN_COLS.map((col) => {
          if (col === "mint") return full;
          if (col === "mint_short") return short;
          if (col === "catalog_number") return newCatalog;
          if (col === "title") return newTitle;
          const v = row[col];
          return v === undefined || v === null ? null : v;
        });
        const placeholders = COIN_COLS.map(() => "?").join(", ");
        await conn.execute(
          `INSERT INTO coins (${COIN_COLS.join(", ")}) VALUES (${placeholders})`,
          vals
        );
      }
    }
    console.log("");
  }

  await conn.end();
  if (!dryRun) {
    console.log("Готово. Дальше: npm run data:export и npm run build.");
  }
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
