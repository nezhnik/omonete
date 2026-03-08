/**
 * Удаление дубликатов Perth по стране: одна и та же монета (одинаковое название) была
 * с Тувалу и Австралия. Правильная страна берётся из data/perth-mint-*.json (Legal Tender).
 * Удаляются записи в coins с неправильной страной.
 *
 * Запуск:
 *   node scripts/remove-perth-country-duplicates.js       — сухой прогон (список id)
 *   node scripts/remove-perth-country-duplicates.js --do — выполнить DELETE
 */
require("dotenv").config({ path: ".env" });
const mysql = require("mysql2/promise");
const fs = require("fs");
const path = require("path");

const DATA_DIR = path.join(__dirname, "..", "data");
const OUT_TXT = path.join(__dirname, "..", "data", "perth-duplicates-to-remove.txt");

function getConfig() {
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
  return { host, port: parseInt(port, 10), user, password, database };
}

function buildMapsFromJson() {
  const files = fs.readdirSync(DATA_DIR).filter((f) => f.startsWith("perth-mint-") && f.endsWith(".json"));
  const titleToCountry = new Map();
  const urlToCountry = new Map();
  files.forEach((f) => {
    const j = JSON.parse(fs.readFileSync(path.join(DATA_DIR, f), "utf8"));
    if (!j.coin) return;
    const country = (j.coin.country || "").trim();
    if (j.coin.source_url) {
      const url = (j.coin.source_url || "").trim();
      if (url && country) urlToCountry.set(url, country);
    }
    if (j.coin.title && country) {
      const key = (j.coin.title || "").trim().toLowerCase();
      if (!titleToCountry.has(key)) titleToCountry.set(key, country);
    }
  });
  return { titleToCountry, urlToCountry };
}

/** Дубликаты ищем в БД; правильная страна — по source_url из JSON, иначе по title. */
async function getIdsToDelete(conn) {
  const { titleToCountry, urlToCountry } = buildMapsFromJson();
  const [rows] = await conn.execute(
    `SELECT id, title, country, source_url FROM coins
     WHERE (country = 'Тувалу' OR country = 'Австралия')
     AND (source_url LIKE '%perthmint.com%' OR source_url IS NULL)
     ORDER BY LOWER(TRIM(title)), country`
  );
  const byTitle = new Map();
  rows.forEach((r) => {
    const key = (r.title || "").trim().toLowerCase();
    if (!key) return;
    if (!byTitle.has(key)) byTitle.set(key, []);
    byTitle.get(key).push({ id: r.id, title: r.title, country: r.country, source_url: r.source_url || "" });
  });
  const toDelete = [];
  const groups = [];
  byTitle.forEach((arr, key) => {
    if (arr.length < 2) return;
    const countries = [...new Set(arr.map((a) => a.country))];
    if (!countries.includes("Тувалу") || !countries.includes("Австралия")) return;
    let correctCountry = null;
    for (const c of arr) {
      if (c.source_url) {
        correctCountry = urlToCountry.get(c.source_url.trim());
        if (correctCountry) break;
      }
    }
    if (!correctCountry) correctCountry = titleToCountry.get(key);
    if (!correctCountry) return;
    const keeper = arr.find((c) => c.country === correctCountry);
    const duplicates = arr.filter((c) => c.country !== correctCountry);
    if (keeper && duplicates.length) {
      groups.push({ keeper, duplicates });
      duplicates.forEach((c) => toDelete.push(c));
    }
  });
  return { toDelete, groups };
}

function formatCoinLink(c, label) {
  const path = "/coins/" + c.id + "/";
  const title = (c.title || "").substring(0, 70);
  const extra = c.source_url ? " " + c.source_url : "";
  return "  " + label + ": " + path + " — «" + title + "» [" + (c.country || "") + "]" + extra;
}

async function main() {
  const doDelete = process.argv.includes("--do");
  const conn = await mysql.createConnection(getConfig());
  let result;
  try {
    result = await getIdsToDelete(conn);
  } catch (e) {
    await conn.end();
    throw e;
  }
  const { toDelete, groups } = result;
  if (toDelete.length === 0) {
    console.log("Дубликатов по стране (Тувалу/Австралия) не найдено.");
    await conn.end();
    return;
  }
  console.log("К удалению (неправильная страна):", toDelete.length, "\n");
  console.log("Список пар: правильная монета (оставляем) → дубликат на удаление\n");
  groups.forEach((g, i) => {
    console.log("--- Группа " + (i + 1) + " ---");
    console.log(formatCoinLink(g.keeper, "Правильная (оставляем)"));
    g.duplicates.forEach((d) => console.log(formatCoinLink(d, "Дубликат на удаление")));
    console.log("");
  });

  const lines = [
    "Дубликаты Perth: правильная монета (оставляем) vs дубликат (удалить). Ссылки относительные: /coins/{id}/",
    "Сгенерировано: " + new Date().toISOString(),
    "",
  ];
  groups.forEach((g, i) => {
    lines.push("--- Группа " + (i + 1) + " ---");
    lines.push("Правильная (оставляем): /coins/" + g.keeper.id + "/ — «" + (g.keeper.title || "").substring(0, 70) + "» [" + (g.keeper.country || "") + "]");
    g.duplicates.forEach((d) => {
      lines.push("Дубликат (удалить):     /coins/" + d.id + "/ — «" + (d.title || "").substring(0, 70) + "» [" + (d.country || "") + "]");
    });
    lines.push("");
  });
  lines.push("Для удаления дубликатов: node scripts/remove-perth-country-duplicates.js --do");
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(OUT_TXT, lines.join("\n"), "utf8");
  console.log("Текстовый файл записан:", OUT_TXT);

  if (!doDelete) {
    console.log("Проверьте выборочно. Для выполнения DELETE запустите: node scripts/remove-perth-country-duplicates.js --do");
    await conn.end();
    return;
  }
  try {
    const ids = toDelete.map((c) => c.id);
    const placeholders = ids.map(() => "?").join(",");
    const [delResult] = await conn.execute("DELETE FROM coins WHERE id IN (" + placeholders + ")", ids);
    console.log("Удалено строк:", delResult.affectedRows);
  } finally {
    await conn.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
