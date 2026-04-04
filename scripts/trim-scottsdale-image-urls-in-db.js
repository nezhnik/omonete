/**
 * Обрезает image_urls у монет Scottsdale в БД до 7 первых путей (как в экспорте).
 * Опционально удаляет лишние файлы из public/image/coins/foreign/scottsdale/<slug>/.
 *
 *   node scripts/trim-scottsdale-image-urls-in-db.js
 *   node scripts/trim-scottsdale-image-urls-in-db.js --delete-files
 */
require("dotenv").config({ path: ".env" });
const fs = require("fs");
const path = require("path");
const mysql = require("mysql2/promise");

const MAX_URLS = 7;
const ROOT = path.join(__dirname, "..");
const PUBLIC = path.join(ROOT, "public");

function getConfig() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL не задан");
  const m = url.match(/mysql:\/\/([^:]+):([^@]+)@([^:]+):(\d+)\/(.+)/);
  if (!m) throw new Error("Неверный формат DATABASE_URL");
  const [, user, password, host, port, database] = m;
  return { host, port: Number(port), user, password, database };
}

function parseImageUrlsColumn(raw) {
  if (raw == null || raw === "") return null;
  if (Array.isArray(raw)) return raw;
  if (typeof Buffer !== "undefined" && Buffer.isBuffer(raw)) {
    try {
      const p = JSON.parse(raw.toString("utf8"));
      return Array.isArray(p) ? p : null;
    } catch {
      return null;
    }
  }
  if (typeof raw === "string") {
    try {
      const p = JSON.parse(raw);
      return Array.isArray(p) ? p : null;
    } catch {
      return null;
    }
  }
  return null;
}

function scottsdaleSlugFromUrl(url) {
  const m = String(url || "").match(/\/foreign\/scottsdale\/([^/]+)\//);
  return m ? m[1] : null;
}

async function main() {
  const deleteFiles = process.argv.includes("--delete-files");
  const conn = await mysql.createConnection(getConfig());
  const [rows] = await conn.execute(
    `SELECT id, image_urls, image_obverse, image_reverse
     FROM coins
     WHERE mint_short = 'Scottsdale Mint' OR mint = 'Scottsdale Mint'
        OR series = 'Scottsdale Mint'`
  );

  const report = { updated: 0, skipped: 0, deleted_files: 0, errors: [] };

  for (const r of rows) {
    const arr = parseImageUrlsColumn(r.image_urls);
    if (!arr || arr.length === 0) {
      report.skipped++;
      continue;
    }
    if (arr.length <= MAX_URLS) {
      report.skipped++;
      continue;
    }

    const trimmed = arr.slice(0, MAX_URLS);
    const kept = new Set(trimmed.map((u) => String(u).trim()).filter(Boolean));
    if (r.image_obverse) kept.add(String(r.image_obverse).trim());
    if (r.image_reverse) kept.add(String(r.image_reverse).trim());

    try {
      await conn.execute("UPDATE coins SET image_urls = ? WHERE id = ?", [JSON.stringify(trimmed), r.id]);
      report.updated++;

      if (deleteFiles) {
        const slug = scottsdaleSlugFromUrl(trimmed[0] || arr[0]);
        if (slug) {
          const dir = path.join(PUBLIC, "image", "coins", "foreign", "scottsdale", slug);
          if (fs.existsSync(dir) && fs.statSync(dir).isDirectory()) {
            for (const fn of fs.readdirSync(dir)) {
              const rel = `/image/coins/foreign/scottsdale/${slug}/${fn}`;
              if (!kept.has(rel)) {
                const fp = path.join(dir, fn);
                try {
                  fs.unlinkSync(fp);
                  report.deleted_files++;
                } catch (e) {
                  report.errors.push({ id: r.id, file: fp, message: e.message });
                }
              }
            }
          }
        }
      }
    } catch (e) {
      report.errors.push({ id: r.id, message: e.message });
    }
  }

  await conn.end();

  const reportPath = path.join(ROOT, "reports", "scottsdale-trim-images-report.json");
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), "utf8");
  console.log("Готово.", report);
  console.log("Отчёт:", reportPath);
  if (deleteFiles && report.deleted_files) {
    console.log("Удалено файлов:", report.deleted_files);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
