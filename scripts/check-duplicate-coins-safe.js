/**
 * Проверка дубликатов монет: не только title + catalog_number + catalog_suffix,
 * но и source_url, weight_g, diameter_mm, metal. Если что-то из этого различается —
 * это могут быть разные монеты, перезаписанные одним каноником (как с Kookaburra).
 * Правило: проверять комплексно — совпадение title+catalog может быть из-за перезаписи,
 * а не реального дубликата; сравниваем source_url, вес, диаметр, металл (и при необходимости
 * изображения); удалять только если все ключевые поля совпадают.
 *
 * Запуск: node scripts/check-duplicate-coins-safe.js
 *
 * Вывод:
 *   - safeDuplicates: группы, где все поля совпадают → можно удалять лишние id
 *   - suspectGroups: группы, где title+catalog совпадают, но source_url или спеки различаются → НЕ удалять
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

/** Сравниваем ключевые поля (игнорируем null/пусто). Если оба заданы и различаются — считаем разными. */
function keyFieldsMatch(a, b) {
  const fields = ["source_url", "weight_g", "diameter_mm", "metal"];
  for (const f of fields) {
    const va = norm(a[f]);
    const vb = norm(b[f]);
    if (va == null || vb == null) continue; // один пустой — не считаем отличием (могло не заполниться)
    const sa = String(va).trim().toLowerCase();
    const sb = String(vb).trim().toLowerCase();
    // weight_g и diameter_mm — числа, сравниваем с допуском
    if (f === "weight_g" || f === "diameter_mm") {
      const na = parseFloat(String(va).replace(",", "."));
      const nb = parseFloat(String(vb).replace(",", "."));
      if (!Number.isNaN(na) && !Number.isNaN(nb) && Math.abs(na - nb) > 0.01) return false;
      continue;
    }
    if (sa !== sb) return false;
  }
  return true;
}

/** Все ли записи в группе совпадают по ключевым полям с первой? */
function allMatchKeyFields(group) {
  if (group.length < 2) return true;
  const first = group[0];
  for (let i = 1; i < group.length; i++) {
    if (!keyFieldsMatch(first, group[i])) return false;
  }
  return true;
}

async function main() {
  const conn = await mysql.createConnection(getConfig());
  const [rows] = await conn.execute(
    `SELECT id, title, catalog_number, catalog_suffix, mint, source_url, weight_g, diameter_mm, thickness_mm, metal
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
      thickness_mm: r.thickness_mm,
      metal: r.metal,
    });
  }

  const safeDuplicates = []; // группы, где все ключевые поля совпадают → можно удалять дубли
  const suspectGroups = [];  // группы, где title+catalog совпадают, но source_url или спеки различаются

  for (const [key, arr] of byKey) {
    if (arr.length < 2) continue;
    arr.sort((a, b) => a.id - b.id);
    if (allMatchKeyFields(arr)) {
      safeDuplicates.push(arr);
    } else {
      suspectGroups.push(arr);
    }
  }

  const safeToDelete = [];
  safeDuplicates.forEach((arr) => {
    for (let i = 1; i < arr.length; i++) safeToDelete.push(arr[i]);
  });

  console.log("=== Группы с одинаковым title + catalog_number + catalog_suffix ===\n");
  console.log("1. Безопасные дубликаты (все ключевые поля совпадают: source_url, weight_g, diameter_mm, metal).");
  console.log("   Можно удалить лишние id, оставив min(id).");
  console.log("   Групп:", safeDuplicates.length, "  Записей к удалению:", safeToDelete.length);
  if (safeToDelete.length > 0 && safeToDelete.length <= 30) {
    safeToDelete.forEach((c) => console.log("     id=" + c.id + "  " + (c.title || "").slice(0, 50) + "  " + (c.catalog_suffix || "")));
  } else if (safeToDelete.length > 30) {
    safeToDelete.slice(0, 15).forEach((c) => console.log("     id=" + c.id + "  " + (c.title || "").slice(0, 50)));
    console.log("     ... и ещё " + (safeToDelete.length - 15));
  }

  console.log("\n2. Подозрительные группы (одинаковый title+catalog, но различаются source_url или спеки).");
  console.log("   Возможные разные монеты, перезаписанные одним каноником. НЕ удалять.");
  console.log("   Групп:", suspectGroups.length);
  for (const arr of suspectGroups) {
    const title = (arr[0].title || "").slice(0, 50);
    console.log("\n   «" + title + "»  suffix=" + (arr[0].catalog_suffix || ""));
    arr.forEach((r) => {
      console.log("     id=" + r.id + "  source_url=" + (r.source_url ? r.source_url.slice(-50) : "null") + "  weight_g=" + r.weight_g + "  diameter_mm=" + r.diameter_mm + "  metal=" + (r.metal || ""));
    });
  }

  if (safeToDelete.length > 0) {
    console.log("\n--- Для удаления только безопасных дубликатов передайте их id в remove-duplicate-coins.js");
    console.log("   Или сохраните список id и удалите вручную. ID безопасных к удалению:", safeToDelete.map((c) => c.id).join(", "));
  }

  await conn.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
