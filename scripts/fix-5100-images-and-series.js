/**
 * Разовое исправление: картинки монеты 5100 (Giant Centipede) и сброс ошибочной серии "Deadly and Dangerous" у остальных Perth.
 */
require("dotenv").config({ path: ".env" });
const mysql = require("mysql2/promise");

function getConfig() {
  const url = process.env.DATABASE_URL;
  const m = url.match(/mysql:\/\/([^:]+):([^@]+)@([^:]+):(\d+)\/(.+)/);
  if (!m) throw new Error("DATABASE_URL?");
  const [, user, password, host, port, database] = m;
  return { host, port: parseInt(port, 10), user, password, database };
}

async function main() {
  const conn = await mysql.createConnection(getConfig());

  // 1) Картинки 5100 — реальные файлы с длинным именем
  const [r1] = await conn.execute(
    `UPDATE coins SET
       image_obverse = '/image/coins/foreign/deadly-and-dangerous-australias-giant-centipede-2026-1oz-silver-proof-coloured-coin-obv.webp',
       image_reverse = '/image/coins/foreign/deadly-and-dangerous-australias-giant-centipede-2026-1oz-silver-proof-coloured-coin-rev.webp',
       image_certificate = '/image/coins/foreign/deadly-and-dangerous-australias-giant-centipede-2026-1oz-silver-proof-coloured-coin-cert.webp'
     WHERE id = 5100`
  );
  console.log("5100: картинки обновлены, affected:", r1.affectedRows);

  // 2) Сбросить series у Perth, у которых в title нет "Deadly and Dangerous" и не Giant Centipede (это та же серия)
  const [r2] = await conn.execute(
    `UPDATE coins SET series = NULL
     WHERE (mint LIKE '%Perth%' OR mint_short LIKE '%Perth%')
       AND series = 'Deadly and Dangerous'
       AND title NOT LIKE '%Deadly and Dangerous%'
       AND title NOT LIKE '%Deadly And Dangerous%'
       AND title NOT LIKE '%Giant Centipede%'`
  );
  console.log("Сброшена серия у записей (не Deadly and Dangerous):", r2.affectedRows);

  await conn.end();
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
