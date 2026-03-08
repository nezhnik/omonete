/**
 * Удаление дубликатов Perth по source_url: оставляем одну запись (с min(id)) на каждый URL,
 * остальные удаляем. После этого импорт (import-perth-mint-to-db.js) добавит недостающие
 * продукты из каноников (374 без записи в БД).
 *
 * Запуск:
 *   node scripts/remove-perth-duplicates-by-source-url.js     — сухой прогон
 *   node scripts/remove-perth-duplicates-by-source-url.js --do — выполнить DELETE
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

function normUrl(u) {
  if (!u || typeof u !== "string") return null;
  return u.trim().replace(/\/+$/, "") || null;
}

async function main() {
  const doDelete = process.argv.includes("--do");
  if (!doDelete) console.log("Режим сухой прогон. Для удаления: node scripts/remove-perth-duplicates-by-source-url.js --do\n");

  const conn = await mysql.createConnection(getConfig());
  const [rows] = await conn.execute(
    `SELECT id, source_url FROM coins WHERE (mint LIKE '%Perth%' OR mint_short LIKE '%Perth%') AND source_url IS NOT NULL AND source_url != '' ORDER BY id`
  );

  const byUrl = new Map();
  rows.forEach((r) => {
    const u = normUrl(r.source_url);
    if (!u) return;
    if (!byUrl.has(u)) byUrl.set(u, []);
    byUrl.get(u).push(r.id);
  });

  const toDelete = [];
  byUrl.forEach((ids) => {
    if (ids.length < 2) return;
    ids.sort((a, b) => a - b);
    for (let i = 1; i < ids.length; i++) toDelete.push(ids[i]);
  });

  if (toDelete.length === 0) {
    console.log("Дубликатов Perth по source_url не найдено.");
    await conn.end();
    return;
  }

  console.log("Записей Perth с дубликатом по source_url (будут удалены):", toDelete.length);
  console.log("Останется уникальных source_url:", byUrl.size);
  if (toDelete.length <= 30) console.log("ID к удалению:", toDelete.join(", "));
  else console.log("ID к удалению (первые 30):", toDelete.slice(0, 30).join(", "), "... и ещё", toDelete.length - 30);

  if (doDelete) {
    const placeholders = toDelete.map(() => "?").join(", ");
    await conn.execute("DELETE FROM coins WHERE id IN (" + placeholders + ")", toDelete);
    console.log("\n✓ Удалено записей:", toDelete.length);
    console.log("Дальше: node scripts/import-perth-mint-to-db.js — подтянет недостающие продукты из каноников, затем export и build.");
  }

  await conn.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
