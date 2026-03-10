/**
 * Однократное применение согласованных правок весов (по комментариям пользователя).
 * НЕ трогает: sovereigns, three-coin set (строки 64–78).
 *
 * Применяем:
 * - 2 kg (7 монет): weight_g=2000, weight_oz='2 кг'
 * - 1/4 унции (8g): 4235, 4236, 4579 → weight_oz='1/4 унции'
 * - 3 унции (93.3g): 4293, 4495, 4744 → weight_oz='3 унции'
 * - 1 г (слитки): 4550, 4551 → weight_oz='1/31,1 унции'
 * - 1/25 унции: 5302 → weight_oz='1/25 унции'
 *
 * Запуск: node scripts/apply-agreed-weight-fixes.js
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

const FIXES = [
  // 2 kilo
  { id: 4418, weight_g: 2000, weight_oz: "2 кг" },
  { id: 4453, weight_g: 2000, weight_oz: "2 кг" },
  { id: 4469, weight_g: 2000, weight_oz: "2 кг" },
  { id: 4492, weight_g: 2000, weight_oz: "2 кг" },
  { id: 4500, weight_g: 2000, weight_oz: "2 кг" },
  { id: 5294, weight_g: 2000, weight_oz: "2 кг" },
  { id: 5609, weight_g: 2000, weight_oz: "2 кг" },
  // 1/4 унции (8g)
  { id: 4235, weight_oz: "1/4 унции" },
  { id: 4236, weight_oz: "1/4 унции" },
  { id: 4579, weight_oz: "1/4 унции" },
  // 3 унции (93.3g)
  { id: 4293, weight_oz: "3 унции" },
  { id: 4495, weight_oz: "3 унции" },
  { id: 4744, weight_oz: "3 унции" },
  // 1 г (слитки SpongeBob)
  { id: 4550, weight_oz: "1/31,1 унции" },
  { id: 4551, weight_oz: "1/31,1 унции" },
  // 1/25 унции
  { id: 5302, weight_oz: "1/25 унции" },
];

async function main() {
  const conn = await mysql.createConnection(getConfig());

  for (const fix of FIXES) {
    const sets = [];
    const vals = [];
    if (fix.weight_g != null) {
      sets.push("weight_g = ?");
      vals.push(fix.weight_g);
    }
    if (fix.weight_oz != null) {
      sets.push("weight_oz = ?");
      vals.push(fix.weight_oz);
    }
    if (!sets.length) continue;
    vals.push(fix.id);
    await conn.execute(`UPDATE coins SET ${sets.join(", ")} WHERE id = ?`, vals);
    console.log("OK id=" + fix.id, fix.weight_g != null ? `weight_g=${fix.weight_g}` : "", fix.weight_oz || "");
  }

  await conn.end();
  console.log("Готово. Обновлено записей:", FIXES.length);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
