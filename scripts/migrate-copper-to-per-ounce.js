/**
 * Одноразовая миграция: пересчитать медь (xcu) из руб/г в руб/тройская унция.
 * 1 тройская унция = 31.1035 г. После миграции xcu в БД — как у драгметаллов (руб/унция).
 *
 * Запуск: node scripts/migrate-copper-to-per-ounce.js (нужен .env с DATABASE_URL).
 */
require("dotenv").config({ path: ".env" });
const mysql = require("mysql2/promise");

const GRAMS_PER_TROY_OZ = 31.1035;

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
  try {
    const [[{ cnt }]] = await conn.execute("SELECT COUNT(*) AS cnt FROM metal_prices WHERE xcu > 0");
    const n = Number(cnt) || 0;
    if (n === 0) {
      console.log("Нет строк с xcu > 0. Миграция не требуется.");
      return;
    }
    const [result] = await conn.execute(
      "UPDATE metal_prices SET xcu = ROUND(xcu * ?, 2) WHERE xcu > 0",
      [GRAMS_PER_TROY_OZ]
    );
    const updated = result.affectedRows ?? 0;
    console.log("✓ Пересчитано xcu (руб/г → руб/унция):", updated, "строк");
  } finally {
    await conn.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
