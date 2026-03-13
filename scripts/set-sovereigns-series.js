/**
 * Ставит единую серию «Sovereigns» всем британским соверенам (золото и серебро).
 * Запуск: node scripts/set-sovereigns-series.js
 */
require("dotenv").config({ path: ".env" });
const mysql = require("mysql2/promise");

const SERIES = "Sovereigns";

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL не задан");
    process.exit(1);
  }
  const m = url.match(/mysql:\/\/([^:]+):([^@]+)@([^:]+):(\d+)\/(.+)/);
  if (!m) {
    console.error("Неверный формат DATABASE_URL");
    process.exit(1);
  }
  const [, user, password, host, port, database] = m;
  const conn = await mysql.createConnection({ host, port: parseInt(port, 10), user, password, database });

  const [rows] = await conn.execute(
    "SELECT id, title, series FROM coins WHERE country = ? AND (title LIKE ? OR series LIKE ? OR title LIKE ?)",
    ["Великобритания", "%Sovereign%", "%Sovereign%", "%Sovereigns%"]
  );
  if (rows.length === 0) {
    console.log("Британских соверенов не найдено.");
    await conn.end();
    return;
  }
  console.log("Найдено монет для серии «Sovereigns»:", rows.length);
  const ids = rows.map((r) => r.id);

  await conn.execute(
    "UPDATE coins SET series = ? WHERE id IN (" + ids.map(() => "?").join(",") + ")",
    [SERIES, ...ids]
  );
  console.log("✓ Серия «Sovereigns» установлена.");
  await conn.end();
  console.log("Дальше: npm run data:export:incremental && npm run build");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
