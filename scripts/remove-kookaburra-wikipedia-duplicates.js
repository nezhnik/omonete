/**
 * Удаляет дубли Kookaburra из импорта Wikipedia (catalog_number ...-B),
 * если есть запись из плана с тем же годом и типом (-1oz, -10oz и т.д.).
 * Оставляем одну запись на монету (план), удаляем -B (Wikipedia).
 *
 * Запуск: node scripts/remove-kookaburra-wikipedia-duplicates.js [--dry]
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

async function main() {
  const dry = process.argv.includes("--dry");
  const conn = await mysql.createConnection(getConfig());

  const [rows] = await conn.execute(
    `SELECT id, title, catalog_number FROM coins
     WHERE series = 'Australian Kookaburra' AND catalog_number LIKE 'AU-KOOK-%'
     ORDER BY catalog_number`
  );

  const withB = rows.filter((r) => (r.catalog_number || "").endsWith("-B"));
  const others = rows.filter((r) => !(r.catalog_number || "").endsWith("-B"));

  const yearType = (cat) => {
    const m = (cat || "").match(/AU-KOOK-(\d{4})(-.+)?$/i);
    if (!m) return null;
    const suf = (m[2] || "").toUpperCase();
    if (/^-B$/.test(suf)) return (m[1] + "-1oz").toLowerCase();
    return (m[1] + (suf || "-1oz")).toLowerCase();
  };

  const otherKeys = new Set(others.map((r) => yearType(r.catalog_number)).filter(Boolean));
  const toDelete = withB.filter((r) => otherKeys.has(yearType(r.catalog_number)));

  console.log("Записей AU-KOOK-*-B (Wikipedia):", withB.length);
  console.log("Записей с другим суффиксом (план и др.):", others.length);
  console.log("Удалить (есть дубликат из плана):", toDelete.length);

  if (toDelete.length === 0) {
    await conn.end();
    return;
  }

  toDelete.forEach((r) => console.log("  ", r.id, r.catalog_number, (r.title || "").slice(0, 45)));

  if (!dry) {
    for (const r of toDelete) {
      await conn.execute("DELETE FROM coins WHERE id = ?", [r.id]);
    }
    console.log("\nУдалено записей:", toDelete.length);
  } else {
    console.log("\nРежим --dry, удаление не выполнено.");
  }
  await conn.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
