/**
 * Удаление только безопасных дубликатов: одинаковые title + catalog_number + catalog_suffix
 * и совпадают source_url, weight_g, diameter_mm, metal. Если спеки различаются — это могут
 * быть разные монеты (перезапись), их не трогаем.
 * Правило: проверять комплексно — title+catalog может совпадать из-за перезаписи, а не дубля;
 * сравниваем source_url, вес, диаметр, металл (и при необходимости изображения); удалять только
 * если все ключевые поля совпадают. Сначала проверка: node scripts/check-duplicate-coins-safe.js
 *
 * Запуск:
 *   node scripts/remove-duplicate-coins.js     — сухой прогон (только безопасные дубликаты)
 *   node scripts/remove-duplicate-coins.js --do — выполнить DELETE
 */
require("dotenv").config({ path: ".env" });
const mysql = require("mysql2/promise");

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

function norm(s) {
  const t = trim(s);
  return t === "" ? null : t;
}

function keyFieldsMatch(a, b) {
  const fields = ["source_url", "weight_g", "diameter_mm", "metal"];
  for (const f of fields) {
    const va = norm(a[f]);
    const vb = norm(b[f]);
    if (va == null || vb == null) continue;
    if (f === "weight_g" || f === "diameter_mm") {
      const na = parseFloat(String(va).replace(",", "."));
      const nb = parseFloat(String(vb).replace(",", "."));
      if (!Number.isNaN(na) && !Number.isNaN(nb) && Math.abs(na - nb) > 0.01) return false;
      continue;
    }
    if (String(va).trim().toLowerCase() !== String(vb).trim().toLowerCase()) return false;
  }
  return true;
}

function allMatchKeyFields(group) {
  if (group.length < 2) return true;
  const first = group[0];
  for (let i = 1; i < group.length; i++) {
    if (!keyFieldsMatch(first, group[i])) return false;
  }
  return true;
}

async function main() {
  const doDelete = process.argv.includes("--do");
  if (!doDelete) console.log("Режим сухой прогон. Удаляются только безопасные дубликаты (совпадают source_url, weight_g, diameter_mm, metal).\n");

  const conn = await mysql.createConnection(getConfig());
  const [rows] = await conn.execute(
    `SELECT id, title, catalog_number, catalog_suffix, mint, source_url, weight_g, diameter_mm, metal
     FROM coins ORDER BY id`
  );

  const byKey = new Map();
  for (const r of rows) {
    const key = trim(r.title).toLowerCase() + "\n" + trim(r.catalog_number) + "\n" + trim(r.catalog_suffix);
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key).push({
      id: r.id,
      title: r.title,
      catalog_number: r.catalog_number,
      catalog_suffix: r.catalog_suffix,
      mint: r.mint,
      source_url: r.source_url,
      weight_g: r.weight_g,
      diameter_mm: r.diameter_mm,
      metal: r.metal,
    });
  }

  const toDelete = [];
  let suspectCount = 0;
  for (const [, arr] of byKey) {
    if (arr.length < 2) continue;
    arr.sort((a, b) => a.id - b.id);
    if (!allMatchKeyFields(arr)) {
      suspectCount++;
      continue;
    }
    for (let i = 1; i < arr.length; i++) toDelete.push(arr[i]);
  }

  if (suspectCount > 0) {
    console.log("Пропущено подозрительных групп (разные спеки при одинаковом title+catalog):", suspectCount);
    console.log("Подробно: node scripts/check-duplicate-coins-safe.js\n");
  }

  if (toDelete.length === 0) {
    console.log("Безопасных дубликатов к удалению не найдено.");
    await conn.end();
    return;
  }

  console.log("Безопасных дубликатов (будут удалены):", toDelete.length);
  toDelete.slice(0, 25).forEach((c) => console.log("  id=" + c.id + "  «" + (c.title || "").slice(0, 50) + "»  " + (c.catalog_suffix || "")));
  if (toDelete.length > 25) console.log("  ... и ещё " + (toDelete.length - 25));

  if (doDelete) {
    const ids = toDelete.map((c) => c.id);
    const placeholders = ids.map(() => "?").join(", ");
    await conn.execute("DELETE FROM coins WHERE id IN (" + placeholders + ")", ids);
    console.log("\n✓ Удалено записей:", ids.length);
    console.log("Дальше: node scripts/export-coins-to-json.js && npm run build");
  }

  await conn.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
