require("dotenv").config({ path: ".env" });
const mysql = require("mysql2/promise");
async function run() {
  const url = process.env.DATABASE_URL;
  const m = url.match(/mysql:\/\/([^:]+):([^@]+)@([^:]+):(\d+)\/(.+)/);
  const [, user, password, host, port, database] = m;
  const conn = await mysql.createConnection({ host, port: parseInt(port, 10), user, password, database });
  const [rows] = await conn.execute("SELECT id, catalog_number, country, title FROM coins WHERE catalog_number IS NOT NULL AND TRIM(catalog_number) != '' ORDER BY id ASC LIMIT 3");
  console.log("Монеты с catalog_number (первые 3):", rows);
  const [ru] = await conn.execute("SELECT COUNT(*) as c FROM coins WHERE country = ? AND catalog_number IS NOT NULL AND TRIM(catalog_number) != ''", ["Россия"]);
  console.log("Российских с catalog_number:", ru[0].c);
  await conn.end();
}
run().catch(console.error);
