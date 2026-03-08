/**
 * Обновляет монеты Perth Mint в БД: вес, металл, качество из названия; страна из номинала (без хардкода).
 * Исправляет: 1/4 oz в названии → 7.78 г; номинал "1 доллар (Тувалу)" → страна Тувалу.
 *
 * Запуск: node scripts/update-perth-coins-from-title.js
 * После: npm run data:export
 */
require("dotenv").config({ path: ".env" });
const mysql = require("mysql2/promise");
const { deriveMetalAndWeightFromTitle, countryFromFaceValue } = require("./format-coin-characteristics.js");

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
  const [rows] = await conn.execute(
    `SELECT id, title, face_value, country, metal, weight_g, weight_oz, quality FROM coins WHERE mint LIKE '%Perth%'`
  );
  let updated = 0;
  for (const r of rows) {
    const fromTitle = deriveMetalAndWeightFromTitle(r.title);
    const newCountry = countryFromFaceValue(r.face_value);
    const newWeightG = fromTitle.weight_g != null ? String(fromTitle.weight_g) : null;
    const newWeightOz = fromTitle.weight_oz != null ? (typeof fromTitle.weight_oz === "number" ? String(fromTitle.weight_oz) : fromTitle.weight_oz) : null;
    const newMetal = fromTitle.metal || null;
    const newQuality = fromTitle.quality || null;
    const curWeightG = r.weight_g != null ? String(r.weight_g).trim() : null;
    const curWeightOz = r.weight_oz != null ? String(r.weight_oz).trim() : null;
    const curCountry = (r.country || "").trim();
    const needCountry = newCountry != null && newCountry !== curCountry;
    const weightExplicitInTitle = newWeightOz != null && newWeightOz !== "1";
    const needWeightUpdate = weightExplicitInTitle && (newWeightG !== curWeightG || newWeightOz !== curWeightOz);
    const needUpdate =
      needCountry ||
      needWeightUpdate ||
      (newMetal != null && newMetal !== (r.metal || "").trim()) ||
      (newQuality != null && newQuality !== (r.quality || "").trim());
    if (!needUpdate) continue;
    const finalWeightG = weightExplicitInTitle ? (newWeightG ?? r.weight_g) : r.weight_g;
    const finalWeightOz = weightExplicitInTitle ? (newWeightOz ?? r.weight_oz) : r.weight_oz;
    await conn.execute(
      `UPDATE coins SET country = ?, weight_g = ?, weight_oz = ?, metal = ?, quality = ? WHERE id = ?`,
      [
        needCountry ? newCountry : r.country,
        finalWeightG,
        finalWeightOz,
        newMetal ?? r.metal,
        newQuality ?? r.quality,
        r.id,
      ]
    );
    updated++;
    const logParts = [];
    if (needCountry) logParts.push("country " + curCountry + " → " + newCountry);
    if (newMetal != null && newMetal !== (r.metal || "").trim()) logParts.push("metal " + (r.metal || "").trim() + " → " + newMetal);
    if (newWeightG !== curWeightG || newWeightOz !== curWeightOz) logParts.push("weight_g " + curWeightG + " → " + newWeightG, "weight_oz " + curWeightOz + " → " + newWeightOz);
    console.log("  id", r.id, "|", (r.title || "").slice(0, 45), "… |", logParts.join(" | "));
  }
  await conn.end();
  console.log("\n✓ Обновлено записей:", updated, "из", rows.length);
  if (updated > 0) console.log("Дальше: npm run data:export");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
