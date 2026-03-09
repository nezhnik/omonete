/**
 * Откат: удаление 28 монет Kookaburra, добавленных import-kookaburra-from-apmex.js
 */
require("dotenv").config({ path: ".env" });
const mysql = require("mysql2/promise");

const TO_DELETE = [
  "AU-KOOK-1994-10oz", "AU-KOOK-1998-10oz", "AU-KOOK-2004-10oz", "AU-KOOK-2005-10oz", "AU-KOOK-2006-10oz",
  "AU-KOOK-2011-10oz", "AU-KOOK-2012-10oz", "AU-KOOK-2013-10oz", "AU-KOOK-2023-10oz",
  "AU-KOOK-1992-1kg", "AU-KOOK-1993-1kg", "AU-KOOK-1995-1kg", "AU-KOOK-1996-1kg", "AU-KOOK-2001-1kg",
  "AU-KOOK-2002-1kg", "AU-KOOK-2005-1kg", "AU-KOOK-2006-1kg", "AU-KOOK-2014-1kg",
  "AU-KOOK-2004-1oz", "AU-KOOK-2005-1oz",
  "AU-KOOK-1996-2oz", "AU-KOOK-1998-2oz", "AU-KOOK-2004-2oz", "AU-KOOK-2006-2oz", "AU-KOOK-2025-2oz",
  "AU-KOOK-2018-5oz", "AU-KOOK-2019-5oz", "AU-KOOK-2020-5oz"
];

async function main() {
  const url = process.env.DATABASE_URL;
  const m = url.match(/mysql:\/\/([^:]+):([^@]+)@([^:]+):(\d+)\/(.+)/);
  const [, user, password, host, port, database] = m;
  const conn = await mysql.createConnection({ host, port: parseInt(port), user, password, database });

  for (const cn of TO_DELETE) {
    const [r] = await conn.execute("DELETE FROM coins WHERE catalog_number = ?", [cn]);
    if (r.affectedRows) console.log("Удалено:", cn);
  }
  await conn.end();
  console.log("Откат завершён.");
}

main().catch((e) => { console.error(e); process.exit(1); });
