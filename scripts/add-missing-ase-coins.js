/**
 * Добавляет в БД все варианты American Silver Eagle по монетным дворам (из GovMint + 2022–2024).
 * Только те catalog_number, которых ещё нет в таблице coins.
 * После запуска: node scripts/update-ase-mintage-govmint.js && node scripts/download-ase-images.js
 *
 * Запуск: node scripts/add-missing-ase-coins.js
 */
require("dotenv").config({ path: ".env" });
const mysql = require("mysql2/promise");

// Полный список: GovMint (1986–2021) + 2022, 2023, 2024 по данным US Mint / Wikipedia
const ASE_MINTAGE = {
  "US-ASE-1986-BU": 5393005,
  "US-ASE-1986-S-P": 1446778,
  "US-ASE-1987-BU": 11442335,
  "US-ASE-1987-S-P": 904732,
  "US-ASE-1988-BU": 5004646,
  "US-ASE-1988-S-P": 557370,
  "US-ASE-1989-BU": 5203327,
  "US-ASE-1989-S-P": 617694,
  "US-ASE-1990-BU": 5840110,
  "US-ASE-1990-S-P": 695510,
  "US-ASE-1991-BU": 7191066,
  "US-ASE-1991-S-P": 511924,
  "US-ASE-1992-BU": 5540068,
  "US-ASE-1992-S-P": 498543,
  "US-ASE-1993-BU": 6763762,
  "US-ASE-1993-P-P": 405913,
  "US-ASE-1994-BU": 4227319,
  "US-ASE-1994-P-P": 372168,
  "US-ASE-1995-BU": 4672051,
  "US-ASE-1995-P-P": 407822,
  "US-ASE-1995-W-P": 30102,
  "US-ASE-1996-BU": 3603386,
  "US-ASE-1996-P-P": 498293,
  "US-ASE-1997-BU": 4295004,
  "US-ASE-1997-P-P": 440315,
  "US-ASE-1998-BU": 4847547,
  "US-ASE-1998-P-P": 450728,
  "US-ASE-1999-BU": 7408640,
  "US-ASE-1999-P-P": 549330,
  "US-ASE-2000-BU": 9239132,
  "US-ASE-2000-P-P": 600743,
  "US-ASE-2001-BU": 9001711,
  "US-ASE-2001-W-P": 746398,
  "US-ASE-2002-BU": 10539026,
  "US-ASE-2002-W-P": 647342,
  "US-ASE-2003-BU": 8495008,
  "US-ASE-2003-W-P": 747831,
  "US-ASE-2004-BU": 8882754,
  "US-ASE-2004-W-P": 801602,
  "US-ASE-2005-BU": 8891025,
  "US-ASE-2005-W-P": 816663,
  "US-ASE-2006-BU": 10676522,
  "US-ASE-2006-P-P": 248875,
  "US-ASE-2006-W-BU": 466573,
  "US-ASE-2006-W-P": 1092475,
  "US-ASE-2007-BU": 9028036,
  "US-ASE-2007-W-BU": 690891,
  "US-ASE-2007-W-P": 821759,
  "US-ASE-2008-BU": 20583000,
  "US-ASE-2008-W-BU": 535000,
  "US-ASE-2008-W-P": 700979,
  "US-ASE-2009-BU": 30459500,
  "US-ASE-2010-BU": 34764500,
  "US-ASE-2010-W-P": 849861,
  "US-ASE-2011-BU": 40020000,
  "US-ASE-2011-S-BU": 99982,
  "US-ASE-2011-W-BU": 409866,
  "US-ASE-2011-W-P": 947454,
  "US-ASE-2012-BU": 37996000,
  "US-ASE-2012-S-P": 285114,
  "US-ASE-2012-W-BU": 226397,
  "US-ASE-2012-W-P": 882260,
  "US-ASE-2013-BU": 42675000,
  "US-ASE-2013-W-BU": 221985,
  "US-ASE-2013-W-P": 869253,
  "US-ASE-2014-BU": 54151500,
  "US-ASE-2014-W-P": 944757,
  "US-ASE-2015-BU": 47000000,
  "US-ASE-2015-W-BU": 223879,
  "US-ASE-2015-W-P": 707518,
  "US-ASE-2016-BU": 37701500,
  "US-ASE-2016-W-BU": 216501,
  "US-ASE-2016-W-P": 595843,
  "US-ASE-2017-BU": 18065500,
  "US-ASE-2017-S-P": 123799,
  "US-ASE-2017-W-BU": 176739,
  "US-ASE-2017-W-P": 440596,
  "US-ASE-2018-BU": 15700000,
  "US-ASE-2018-S-P": 158791,
  "US-ASE-2018-W-BU": 138947,
  "US-ASE-2018-W-P": 411512,
  "US-ASE-2019-BU": 14863500,
  "US-ASE-2019-S-P": 199619,
  "US-ASE-2019-W-BU": 138390,
  "US-ASE-2019-W-P": 375180,
  "US-ASE-2020-BU": 30089500,
  "US-ASE-2020-S-P": 208871,
  "US-ASE-2020-W-BU": 154864,
  "US-ASE-2020-W-P": 381112,
  "US-ASE-2021-BU": 28274500,
  "US-ASE-2021-S-P": 275676,
  "US-ASE-2021-W-P": 417187,
  "US-ASE-2022-BU": 16000000,
  "US-ASE-2022-W-P": 212997,
  "US-ASE-2023-BU": 24750000,
  "US-ASE-2023-W-P": 163902,
  "US-ASE-2024-BU": 24862000,
  "US-ASE-2024-W-P": 113787,
  "US-ASE-2025-BU": 0,
  "US-ASE-2025-W-P": 207940,
  "US-ASE-2026-BU": 0,
  "US-ASE-2026-W-P": 209027,
};

/** По суффиксу catalog_number (например S-P, W-BU) — русское и англ. название двора, качество */
function parseSuffix(catalogNumber) {
  const m = String(catalogNumber || "").match(/US-ASE-\d{4}-(.+)$/i);
  const suffix = (m && m[1]) || "BU";
  const year = (catalogNumber || "").match(/US-ASE-(\d{4})/)?.[1] || "";
  const isProof = /-P$/.test(suffix) || suffix === "P-P" || suffix === "S-P" || suffix === "W-P";
  const qualityRu = isProof ? "Пруф" : "АЦ";
  const qualityEn = isProof ? "Proof" : "BU";
  let mintRu = "Монетный двор США";
  let mintShort = "US Mint";
  let letter = "";
  if (suffix.startsWith("S-")) {
    mintRu = "Сан-Франциско";
    mintShort = "San Francisco";
    letter = "S";
  } else if (suffix.startsWith("P-")) {
    mintRu = "Филадельфия";
    mintShort = "Philadelphia";
    letter = "P";
  } else if (suffix.startsWith("W-")) {
    mintRu = "Вест-Поинт";
    mintShort = "West Point";
    letter = "W";
  }
  const titleRu = letter ? `Американский серебряный орёл ${year} (${letter})` : `Американский серебряный орёл ${year}`;
  const titleEn = letter ? `American Silver Eagle ${year} (${letter})` : `American Silver Eagle ${year}`;
  return { mintRu, mintShort, qualityRu, qualityEn, titleRu, titleEn };
}

function getConfig() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL не задан в .env");
    process.exit(1);
  }
  const m = url.match(/mysql:\/\/([^:]+):([^@]+)@([^:]+):(\d+)\/(.+)/);
  if (!m) {
    console.error("Неверный формат DATABASE_URL");
    process.exit(1);
  }
  const [, user, password, host, port, database] = m;
  return { host, port: parseInt(port, 10), user, password, database };
}

async function main() {
  const conn = await mysql.createConnection(getConfig());

  let hasTitleEn = false;
  try {
    const [cols] = await conn.execute(
      "SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'coins' AND COLUMN_NAME = 'title_en'"
    );
    hasTitleEn = cols.length > 0;
  } catch (_) {}

  const colsBase = [
    "title", "title_en", "series", "country", "face_value", "mint", "mint_short",
    "metal", "metal_fineness", "mintage", "mintage_display", "weight_g", "weight_oz",
    "release_date", "catalog_number", "catalog_suffix", "quality",
    "diameter_mm", "thickness_mm", "image_obverse", "image_reverse"
  ];
  const cols = hasTitleEn ? colsBase : colsBase.filter((k) => k !== "title_en");

  let inserted = 0;
  let skipped = 0;

  for (const [catalogNumber, mintage] of Object.entries(ASE_MINTAGE)) {
    const [existing] = await conn.execute(
      "SELECT id FROM coins WHERE catalog_number = ? LIMIT 1",
      [catalogNumber]
    );
    if (existing.length > 0) {
      skipped++;
      continue;
    }

    const year = (catalogNumber.match(/US-ASE-(\d{4})/) || [])[1] || "";
    const { mintRu, mintShort, qualityRu, titleRu, titleEn } = parseSuffix(catalogNumber);
    const catalogSuffix = year.slice(2) + (mintShort === "San Francisco" ? "S" : mintShort === "West Point" ? "W" : mintShort === "Philadelphia" ? "P" : "");

    const values = [
      titleRu,
      ...(hasTitleEn ? [titleEn] : []),
      "American Eagle",
      "США",
      "1 доллар",
      mintRu,
      mintShort,
      "Серебро",
      "999/1000",
      mintage,
      null,
      31.1,
      "1 унция",
      year ? `${year}-01-01` : null,
      catalogNumber,
      catalogSuffix,
      qualityRu,
      40.6,
      2.98,
      null,
      null
    ];

    const placeholders = cols.map(() => "?").join(", ");
    await conn.execute(
      `INSERT INTO coins (${cols.join(", ")}) VALUES (${placeholders})`,
      values
    );
    inserted++;
    console.log("  +", catalogNumber, mintage);
  }

  await conn.end();
  console.log("\n✓ Добавлено ASE:", inserted, "| Уже было:", skipped);
  if (inserted > 0) {
    console.log("Дальше: node scripts/update-ase-mintage-govmint.js && node scripts/download-ase-images.js && npm run build");
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
