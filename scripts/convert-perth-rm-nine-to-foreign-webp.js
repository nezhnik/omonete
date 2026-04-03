/**
 * Perth (временные исходники) → public/image/coins/foreign/*.webp
 * Параметры как в fetch-royal-mint-coin-test.js (downloadWebp): max 1200px, webp q82.
 *
 * Запуск: node scripts/convert-perth-rm-nine-to-foreign-webp.js
 */
const fs = require("fs");
const path = require("path");
const sharp = require("sharp");

const PERTH = path.join(__dirname, "..", "public", "image", "coins", "Perth");
const FOREIGN = path.join(__dirname, "..", "public", "image", "coins", "foreign");
const MAX_SIDE = 1200;
const WEBP = { quality: 82, effort: 6, smartSubsample: true };

/** [имя файла в Perth, имя в foreign] */
const PAIRS = [
  ["1997 Britannia Silver Set-obv.png", "britannia-silver-set-obv.webp"],
  ["1997 Britannia Silver Set-rev.png", "britannia-silver-set-rev.webp"],
  ["1997 Britannia Silver Set-box.jpeg", "britannia-silver-set-box.webp"],
  ["National Gallery 2024 UK £2 Silver Proof Piedfort Coin-obv.webp", "national-gallery-2024-2-pound-silver-proof-piedfort-coin-obv.webp"],
  ["National Gallery 2024 UK £2 Silver Proof Piedfort Coin-rev.webp", "national-gallery-2024-2-pound-silver-proof-piedfort-coin-rev.webp"],
  ["National Gallery 2024 UK £2 Silver Proof Piedfort Coin-box.webp", "national-gallery-2024-2-pound-silver-proof-piedfort-coin-box.webp"],
  ["National Gallery 2024 UK £2 Silver Proof Piedfort Coin-pack.webp", "national-gallery-2024-2-pound-silver-proof-piedfort-coin-cert.webp"],
  [
    "Elizabeth II The Fourth Effigy 2026 UK £5 Silver Proof Piedfort Coin-obv.webp",
    "portraits-of-a-queen-elizabeth-ii-the-fourth-effigy-2026-silver-proof-piedfort-coin-obv.webp",
  ],
  [
    "Elizabeth II The Fourth Effigy 2026 UK £5 Silver Proof Piedfort Coin-rev.webp",
    "portraits-of-a-queen-elizabeth-ii-the-fourth-effigy-2026-silver-proof-piedfort-coin-rev.webp",
  ],
  [
    "Elizabeth II The Fourth Effigy 2026 UK £5 Silver Proof Piedfort Coin-box.webp",
    "portraits-of-a-queen-elizabeth-ii-the-fourth-effigy-2026-silver-proof-piedfort-coin-box.webp",
  ],
  [
    "Elizabeth II The Fourth Effigy 2026 UK £5 Silver Proof Piedfort Coin-pack.webp",
    "portraits-of-a-queen-elizabeth-ii-the-fourth-effigy-2026-silver-proof-piedfort-coin-cert.webp",
  ],
  [
    "The 75th Birthday of HRH The Princess Royal Collector Coin Set-obv.png",
    "the-75th-birthday-of-hrh-the-princess-royal-collector-coin-set-obv.webp",
  ],
  [
    "The 75th Birthday of HRH The Princess Royal Collector Coin Set-rev.png",
    "the-75th-birthday-of-hrh-the-princess-royal-collector-coin-set-rev.webp",
  ],
  [
    "The 75th Birthday of HRH The Princess Royal Collector Coin Set-box.jpeg",
    "the-75th-birthday-of-hrh-the-princess-royal-collector-coin-set-box.webp",
  ],
  ["2004 UK Proof Half Sovereign-obv.jpeg", "2004-uk-proof-half-sovereign-obv.webp"],
  ["2004 UK Proof Half Sovereign-rev.jpeg", "2004-uk-proof-half-sovereign-rev.webp"],
  ["2013 Elizabeth II Brilliant Uncirculated Sovereign-obv.jpeg", "2013-sovereign-i-mint-mark-obv.webp"],
  ["2013 Elizabeth II Brilliant Uncirculated Sovereign-rev.jpeg", "2013-sovereign-i-mint-mark-rev.webp"],
  ["2014 Sovereign I Mint Mark-obv.jpeg", "2014-sovereign-i-mint-mark-obv.webp"],
  ["2014 Sovereign I Mint Mark-rev.jpeg", "2014-sovereign-i-mint-mark-rev.webp"],
  ["2006 UK Proof Half Sovereign-obv.jpeg", "hishso06-obv.webp"],
  ["2006 UK Proof Half Sovereign-rev.jpeg", "hishso06-rev.webp"],
  ["2006 UK Proof Half Sovereign-pack.jpeg", "hishso06-cert.webp"],
  ["Lunar Year of the Horse 2026 UK 1oz Gold Proof Coin-obv.webp", "lunar-year-of-the-horse-1-oz-gold-proof-coin-obv.webp"],
  ["Lunar Year of the Horse 2026 UK 1oz Gold Proof Coin-rev.jpeg", "lunar-year-of-the-horse-1-oz-gold-proof-coin-rev.webp"],
  ["Lunar Year of the Horse 2026 UK 1oz Gold Proof Coin-box.webp", "lunar-year-of-the-horse-1-oz-gold-proof-coin-box.webp"],
];

async function convertOne(srcPath, destPath) {
  const buf = await fs.promises.readFile(srcPath);
  await sharp(buf)
    .resize(MAX_SIDE, MAX_SIDE, { fit: "inside", withoutEnlargement: true })
    .webp(WEBP)
    .toFile(destPath);
}

async function main() {
  let ok = 0;
  for (const [from, to] of PAIRS) {
    const src = path.join(PERTH, from);
    if (!fs.existsSync(src)) {
      console.error("Нет в Perth:", from);
      process.exitCode = 1;
      continue;
    }
    const dest = path.join(FOREIGN, to);
    await convertOne(src, dest);
    console.log("✓", to);
    ok++;
  }
  console.log("\nГотово:", ok, "файлов →", FOREIGN);
  if (process.exitCode) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
