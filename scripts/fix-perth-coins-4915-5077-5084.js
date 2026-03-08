/**
 * Разовое исправление: у монет 4915, 5077, 5084 были один catalog_number и чужие картинки.
 * Подставляем из канонических JSON: правильные catalog_number, картинки.
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

const FIXES = [
  {
    id: 4915,
    catalog_number: "AU-PERTH-2025-25117EAAA",
    catalog_suffix: "25x41aaa",
    image_obverse: "/image/coins/foreign/australian-koala-2025-1-2oz-gold-proof-coin-obv.webp",
    image_reverse: "/image/coins/foreign/australian-koala-2025-1-2oz-gold-proof-coin-rev.webp",
    image_box: "/image/coins/foreign/australian-koala-2025-1-2oz-gold-proof-coin-box.webp",
    image_certificate: "/image/coins/foreign/australian-koala-2025-1-2oz-gold-proof-coin-cert.webp",
  },
  {
    id: 5077,
    catalog_number: "AU-PERTH-2025-25X41AAA",
    catalog_suffix: "25x41aaa",
    image_obverse: "/image/coins/foreign/australian-wedge-tailed-eagle-2025-1-kilo-gold-proof-ultra-high-relief-gilded-coin-obv.webp",
    image_reverse: "/image/coins/foreign/australian-wedge-tailed-eagle-2025-1-kilo-gold-proof-ultra-high-relief-gilded-coin-rev.webp",
    image_box: "/image/coins/foreign/australian-wedge-tailed-eagle-2025-1-kilo-gold-proof-ultra-high-relief-gilded-coin-box.webp",
    image_certificate: "/image/coins/foreign/australian-wedge-tailed-eagle-2025-1-kilo-gold-proof-ultra-high-relief-gilded-coin-cert.webp",
  },
  {
    id: 5084,
    catalog_number: "AU-PERTH-2025-Y25027DAAD",
    catalog_suffix: "25x41aaa",
    image_obverse: "/image/coins/foreign/beijing-international-coin-expo-australian-koala-2025-1oz-silver-coin-panda-privy-obv.webp",
    image_reverse: "/image/coins/foreign/beijing-international-coin-expo-australian-koala-2025-1oz-silver-coin-panda-privy-rev.webp",
    image_box: null,
    image_certificate: null,
  },
];

async function main() {
  const conn = await mysql.createConnection(getConfig());
  for (const f of FIXES) {
    await conn.execute(
      `UPDATE coins SET
         catalog_number = ?, catalog_suffix = ?,
         image_obverse = ?, image_reverse = ?, image_box = ?, image_certificate = ?
       WHERE id = ?`,
      [f.catalog_number, f.catalog_suffix, f.image_obverse, f.image_reverse, f.image_box, f.image_certificate, f.id]
    );
    console.log("OK id=" + f.id, f.catalog_number);
  }
  await conn.end();
}

main()
  .then(() => process.exit(0))
  .catch((e) => { console.error(e); process.exit(1); });
