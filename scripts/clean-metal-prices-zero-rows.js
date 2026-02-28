/**
 * Одноразовая очистка БД: удалить из metal_prices строки, где у золота, серебра, платины и палладия цены 0.
 * Это выходные/праздники (строки появились из-за INSERT по меди). Для меди используем ту же логику — только дни, когда есть данные ЦБ.
 *
 * Запуск: node scripts/clean-metal-prices-zero-rows.js (нужен .env с DATABASE_URL).
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
  try {
    const [[{ cnt }]] = await conn.execute(
      "SELECT COUNT(*) AS cnt FROM metal_prices WHERE xau = 0 AND xag = 0 AND xpt = 0 AND xpd = 0"
    );
    const toDelete = Number(cnt) || 0;
    if (toDelete === 0) {
      console.log("Нет строк с нулями по драгметаллам (xau=xag=xpt=xpd=0). БД уже в порядке.");
      return;
    }
    const [result] = await conn.execute(
      "DELETE FROM metal_prices WHERE xau = 0 AND xag = 0 AND xpt = 0 AND xpd = 0"
    );
    const deleted = result.affectedRows ?? toDelete;
    console.log("✓ Удалено строк (выходные/праздники, данные только по меди):", deleted);
  } finally {
    await conn.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
