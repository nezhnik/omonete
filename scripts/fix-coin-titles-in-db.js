/**
 * Чистит title (и title_en, если есть столбец) в таблице coins — та же логика, что cleanTitle в export-coins-to-json.js.
 *
 * После успешного прогона при необходимости: node scripts/export-coins-to-json.js
 *
 * Запуск: node scripts/fix-coin-titles-in-db.js
 */
require("dotenv").config({ path: ".env" });
const mysql = require("mysql2/promise");

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

function cleanTitle(s) {
  if (s == null || typeof s !== "string") return "";
  return s
    .replace(/<nobr>/gi, "")
    .replace(/<\/nobr>/gi, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/\bWe value your privacy\b/gi, "")
    .replace(/\s+(?:Obverse|Awers):\s*.+$/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

async function main() {
  const cfg = getConfig();
  const conn = await mysql.createConnection(cfg);

  let rows;
  let hasTitleEn = true;
  try {
    [rows] = await conn.query("SELECT id, title, title_en FROM coins");
  } catch (e) {
    if (e && /Unknown column ['`]title_en['`]/i.test(String(e.message))) {
      hasTitleEn = false;
      [rows] = await conn.query("SELECT id, title FROM coins");
    } else {
      throw e;
    }
  }

  let updated = 0;
  for (const r of rows) {
    const newTitle = cleanTitle(r.title);
    let newTitleEn = r.title_en;
    if (hasTitleEn) {
      if (r.title_en != null && String(r.title_en).trim() !== "") {
        newTitleEn = cleanTitle(String(r.title_en)) || null;
      }
    }

    const titleChanged = newTitle !== r.title;
    const enChanged = hasTitleEn && String(r.title_en ?? "") !== String(newTitleEn ?? "");

    if (!titleChanged && !enChanged) continue;

    if (hasTitleEn) {
      await conn.execute("UPDATE coins SET title = ?, title_en = ? WHERE id = ?", [newTitle, newTitleEn, r.id]);
    } else {
      await conn.execute("UPDATE coins SET title = ? WHERE id = ?", [newTitle, r.id]);
    }
    updated++;
    if (updated <= 30) {
      console.log(`id ${r.id}:`, (r.title || "").slice(0, 70), "→", newTitle.slice(0, 70));
    }
  }

  await conn.end();
  console.log("Готово. Обновлено строк:", updated);
  if (updated > 30) console.log("(показаны первые 30 изменений)");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
