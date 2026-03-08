/**
 * Находит дубликаты среди data/perth-mint-*.json по паре (catalog_number + title).
 * Один catalog_number может быть у разных монет — дубль только если совпадают и номер, и название.
 * Оставляем файл с source_url и/или более длинным slug; удаляем только явные дубли (тот же продукт).
 *
 * Запуск:
 *   node scripts/find-perth-json-duplicates.js           — только показать дубли
 *   node scripts/find-perth-json-duplicates.js --delete  — удалить ошибочные (без source_url или короче)
 */
const fs = require("fs");
const path = require("path");

const DATA_DIR = path.join(__dirname, "..", "data");

function normTitle(s) {
  return (s || "").trim().toLowerCase().replace(/\s+/g, " ");
}

function main() {
  const doDelete = process.argv.includes("--delete");
  const files = fs.readdirSync(DATA_DIR)
    .filter((f) => f.startsWith("perth-mint-") && f.endsWith(".json") && f !== "perth-mint-fetch-progress.json" && f !== "perth-mint-image-url-cache.json");

  const byKey = new Map();
  for (const f of files) {
    const filePath = path.join(DATA_DIR, f);
    let raw;
    try {
      raw = fs.readFileSync(filePath, "utf8");
    } catch (e) {
      continue;
    }
    let data;
    try {
      data = JSON.parse(raw);
    } catch (e) {
      continue;
    }
    const c = data.coin;
    if (!c || !c.catalog_number) continue;
    const catalog = String(c.catalog_number).trim();
    const title = normTitle(c.title);
    if (!title) continue;
    const key = catalog + "\n" + title;
    if (!byKey.has(key)) byKey.set(key, []);
    const hasSourceUrl = !!(c.source_url && String(c.source_url).trim());
    byKey.get(key).push({
      file: f,
      filePath,
      hasSourceUrl,
      slugLen: f.length,
      title: (c.title || "").trim(),
    });
  }

  const toDelete = [];
  const examples = [];
  byKey.forEach((arr, key) => {
    if (arr.length < 2) return;
    const withUrl = arr.filter((a) => a.hasSourceUrl);
    const keep = withUrl.length > 0 ? withUrl.sort((a, b) => b.slugLen - a.slugLen)[0] : arr.sort((a, b) => b.slugLen - a.slugLen)[0];
    const deletes = arr.filter((a) => a.file !== keep.file);
    deletes.forEach((a) => toDelete.push({ key: key.replace("\n", " | "), ...a }));
    if (examples.length < 10) examples.push({ key: key.replace("\n", " | "), keep, deletes });
  });

  if (toDelete.length === 0) {
    console.log("Дублей (одинаковые catalog_number + title) не найдено.");
    return;
  }
  console.log("Найдено дублей (одинаковые catalog_number и title):", toDelete.length);
  console.log("\n--- Примеры пар (оставляем / удалить) — первые 10 групп ---\n");
  examples.forEach((ex, i) => {
    console.log("Группа " + (i + 1) + ":", ex.key);
    console.log("  Оставляем:  ", ex.keep.file);
    ex.deletes.forEach((d) => console.log("  Удалить:     ", d.file));
    console.log("");
  });
  console.log("--- Остальные файлы на удаление (" + (toDelete.length - examples.reduce((s, ex) => s + ex.deletes.length, 0)) + ") ---");
  let shown = 0;
  toDelete.forEach((d) => {
    if (shown < 20) {
      console.log("  ", d.file);
      shown++;
    }
  });
  if (toDelete.length > 20) console.log("  ... и ещё", toDelete.length - 20);

  if (!doDelete) {
    console.log("\nДля удаления этих файлов: node scripts/find-perth-json-duplicates.js --delete");
    return;
  }
  let deleted = 0;
  toDelete.forEach((d) => {
    try {
      fs.unlinkSync(d.filePath);
      console.log("Удалён:", d.file);
      deleted++;
    } catch (e) {
      console.warn("Не удалось удалить", d.file, e.message);
    }
  });
  console.log("Удалено файлов:", deleted);
}

main();
