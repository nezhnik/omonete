/**
 * Дубликаты монет The Royal Mint в БД: одна и та же монета могла попасть дважды
 * (разный source_url / catalog_number при похожем товаре).
 *
 * Ключ группировки (все четыре должны совпасть):
 *   — нормализованное название (title),
 *   — год (release_date → YEAR; иначе первый 19xx/20xx в title/title_en),
 *   — вес weight_g (число с допуском 0.01 г),
 *   — тираж: mintage; если NULL — нормализация mintage_display (только цифры) или «без тиража».
 *
 * Запуск:
 *   node scripts/check-royal-mint-duplicates.js
 *   node scripts/check-royal-mint-duplicates.js --json   — data/royal-mint-duplicate-report.json
 *
 * Удаление из скрипта не делаем: только отчёт. Сверь source_url и реши вручную или отдельным DELETE.
 *
 * При парсинге/импорте Royal Mint см. также royal-mint-spec-duplicate-lib.js и лог
 * data/royal-mint-spec-collision-review.jsonl — совпадение по спекам до вставки.
 */
require("dotenv").config({ path: ".env" });
const fs = require("fs");
const path = require("path");
const mysql = require("mysql2/promise");

/**
 * Только монеты с сайта Royal Mint UK: каталог GB-ROYAL-* или явный royalmint.com в source_url.
 * Иначе в отчёт попадают Perth и др. с похожим названием при поле mint.
 */
const ROYAL_FILTER = `(
  catalog_number LIKE 'GB-ROYAL-%'
  OR (
    source_url LIKE '%royalmint.com%'
    AND (mint LIKE '%Royal Mint%' OR mint_short LIKE '%Royal Mint%')
  )
)`;

function getConfig() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL не задан");
  const m = url.match(/mysql:\/\/([^:]+):([^@]+)@([^:]+):(\d+)\/(.+)/);
  if (!m) throw new Error("Неверный формат DATABASE_URL");
  const [, user, password, host, port, database] = m;
  return { host, port: parseInt(port, 10), user, password, database };
}

function normTitle(s) {
  return String(s || "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function yearFromRow(r) {
  if (r.release_date) {
    const d = new Date(r.release_date);
    const y = d.getFullYear();
    if (!Number.isNaN(y) && y >= 1800 && y <= 2100) return y;
  }
  const t = `${r.title || ""} ${r.title_en || ""}`;
  const m = t.match(/\b(19|20)\d{2}\b/);
  return m ? parseInt(m[0], 10) : null;
}

function normWeightKey(r) {
  if (r.weight_g == null || String(r.weight_g).trim() === "") return "__no_weight__";
  const n = parseFloat(String(r.weight_g).replace(",", "."));
  if (Number.isNaN(n)) return "__no_weight__";
  return String(Math.round(n * 100) / 100);
}

function normMintageKey(r) {
  if (r.mintage != null && r.mintage !== "" && Number.isFinite(Number(r.mintage))) {
    return "n:" + String(Math.trunc(Number(r.mintage)));
  }
  const disp = String(r.mintage_display || "").replace(/\s/g, "");
  const digits = disp.replace(/[^\d]/g, "");
  if (digits.length > 0) return "d:" + digits;
  return "__no_mintage__";
}

function duplicateGroupKey(r) {
  const title = normTitle(r.title);
  const year = yearFromRow(r);
  const w = normWeightKey(r);
  const m = normMintageKey(r);
  return [title, year === null ? "__no_year__" : String(year), w, m].join("\t");
}

function canonicalSourceUrl(u) {
  if (!u || typeof u !== "string") return "";
  try {
    const x = new URL(u.trim());
    x.hash = "";
    x.search = "";
    return x.toString().replace(/\/$/, "").toLowerCase();
  } catch {
    return u.trim().split("?")[0].split("#")[0].replace(/\/$/, "").toLowerCase();
  }
}

async function main() {
  const writeJson = process.argv.includes("--json");
  const conn = await mysql.createConnection(getConfig());

  let hasTitleEn = false;
  try {
    const [cols] = await conn.execute(
      "SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'coins' AND COLUMN_NAME = 'title_en'"
    );
    hasTitleEn = cols.length > 0;
  } catch {
    /* ignore */
  }

  const select = hasTitleEn
    ? `SELECT id, title, title_en, release_date, weight_g, mintage, mintage_display,
              catalog_number, catalog_suffix, source_url, mint, mint_short
       FROM coins WHERE ${ROYAL_FILTER} ORDER BY id`
    : `SELECT id, title, release_date, weight_g, mintage, mintage_display,
              catalog_number, catalog_suffix, source_url, mint, mint_short
       FROM coins WHERE ${ROYAL_FILTER} ORDER BY id`;

  const [rows] = await conn.execute(select);
  await conn.end();

  const byKey = new Map();
  for (const r of rows) {
    const key = duplicateGroupKey(r);
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key).push(r);
  }

  const duplicates = [];
  for (const [key, arr] of byKey) {
    if (arr.length < 2) continue;
    arr.sort((a, b) => a.id - b.id);
    const urls = arr.map((x) => canonicalSourceUrl(x.source_url));
    const uniqueUrls = new Set(urls.filter(Boolean));
    duplicates.push({
      key,
      count: arr.length,
      sameCanonicalUrl: uniqueUrls.size <= 1,
      rows: arr.map((x) => ({
        id: x.id,
        title: x.title,
        title_en: hasTitleEn ? x.title_en : undefined,
        release_date: x.release_date,
        year: yearFromRow(x),
        weight_g: x.weight_g,
        mintage: x.mintage,
        mintage_display: x.mintage_display,
        catalog_number: x.catalog_number,
        catalog_suffix: x.catalog_suffix,
        source_url: x.source_url,
      })),
    });
  }

  duplicates.sort((a, b) => b.count - a.count || a.key.localeCompare(b.key));

  console.log("=== Дубликаты The Royal Mint (одинаковые: название + год + вес + тираж) ===\n");
  console.log("Всего записей Royal Mint в БД:", rows.length);
  console.log("Групп с 2+ монетами:", duplicates.length);
  if (duplicates.length === 0) {
    console.log("\nДубликатов по этому критерию не найдено.");
    return;
  }

  let sameUrlGroups = 0;
  for (const g of duplicates) {
    if (g.sameCanonicalUrl) sameUrlGroups += 1;
  }
  console.log("Из них все строки с одним и тем же каноническим source_url:", sameUrlGroups);
  console.log("(остальные — разные URL при совпадении спек; проверь, не две ли карточки сайта на один товар.)\n");

  for (const g of duplicates) {
    const sample = g.rows[0];
    console.log("—".repeat(72));
    console.log(
      "Группа ×" + g.count + " | год=" + sample.year + " | weight_g=" + sample.weight_g + " | mintage=" + sample.mintage + " | display=" + (sample.mintage_display || "—")
    );
    console.log("Название:", (sample.title || "").slice(0, 100));
    console.log("Ключ (нормализация): title+year+weight+mintage");
    if (g.sameCanonicalUrl) console.log("[все записи с одним каноническим PDP — вероятно реальные дубли в БД]");
    g.rows.forEach((r) => {
      console.log(
        "  id=" + r.id + "  cat=" + (r.catalog_number || "").slice(0, 40) + "  url=" + (r.source_url || "").slice(0, 85)
      );
    });
  }

  console.log("\n" + "—".repeat(72));
  console.log("Рекомендация: оставить одну запись (обычно минимальный id), остальные удалить только после проверки source_url.");
  console.log("Если URL разные — открой обе страницы на royalmint.com; часто одна ведёт на ту же монету.");

  if (writeJson) {
    const out = path.join(__dirname, "..", "data", "royal-mint-duplicate-report.json");
    fs.writeFileSync(
      out,
      JSON.stringify({ generatedAt: new Date().toISOString(), totalRoyalMintRows: rows.length, duplicateGroups: duplicates }, null, 2),
      "utf8"
    );
    console.log("\nJSON:", out);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
