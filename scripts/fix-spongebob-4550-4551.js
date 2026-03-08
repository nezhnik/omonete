/**
 * Разовое исправление: монеты 4550 и 4551 (SpongeBob 1g gold bars) — страна Австралия,
 * размеры 15.6×9.1 мм, вес в унциях 0.032, rectangular выводится по length_mm+width_mm при экспорте.
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
  const conn = await mysql.createConnection(getConfig());
  // 4550 — Coloured: уже Австралия, length_mm, width_mm есть; только weight_oz
  await conn.execute(
    "UPDATE coins SET country = ?, weight_oz = ?, length_mm = ?, width_mm = ? WHERE id = 4550",
    ["Австралия", "0.032", "15.6", "9.1"]
  );
  console.log("4550: country, weight_oz, length_mm, width_mm");
  // 4551 — обычный бар: страна, размеры, вес в унциях
  await conn.execute(
    "UPDATE coins SET country = ?, face_value = ?, weight_oz = ?, length_mm = ?, width_mm = ?, thickness_mm = ? WHERE id = 4551",
    ["Австралия", null, "0.032", "15.6", "9.1", "1.3"]
  );
  console.log("4551: country, face_value, weight_oz, length_mm, width_mm, thickness_mm");
  await conn.end();
  console.log("Готово. Дальше: node scripts/export-coins-to-json.js");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
