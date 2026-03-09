/**
 * Проверка: у монет Perth (source_url содержит perthmint.com) картинки должны
 * содержать slug из source_url: /image/coins/foreign/<slug>-obv.webp и т.д.
 *
 * Запуск: node scripts/check-perth-images-by-source-url.js
 */

require("dotenv").config({ path: ".env" });
const mysql = require("mysql2/promise");
const path = require("path");
const fs = require("fs");

function getConfig() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL не задан");
  const m = url.match(/mysql:\/\/([^:]+):([^@]+)@([^:]+):(\d+)\/(.+)/);
  if (!m) throw new Error("Неверный формат DATABASE_URL");
  const [, user, password, host, port, database] = m;
  return { host, port: parseInt(port, 10), user, password, database };
}

function slugFromSourceUrl(url) {
  if (!url) return null;
  const pathname = String(url).replace(/^https?:\/\/[^/]+/, "").replace(/\?.*$/, "").replace(/\/$/, "");
  const segments = pathname.split("/").filter(Boolean);
  const last = segments[segments.length - 1] || "";
  return last
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "") || null;
}

async function main() {
  const fixMode = process.argv.includes("--fix");
  if (fixMode) console.log("Режим --fix: исправляю пути в БД по slug (только если файл есть).\n");

  const conn = await mysql.createConnection(getConfig());
  const [rows] = await conn.execute(
    `SELECT id, title, catalog_number, source_url, image_obverse, image_reverse, image_box, image_certificate
     FROM coins WHERE source_url IS NOT NULL AND source_url LIKE '%perthmint.com%' ORDER BY id`
  );

  const publicDir = path.join(__dirname, "..", "public");
  const problems = [];
  const toUpdate = []; // { id, image_obverse?, image_reverse?, image_box?, image_certificate? }
  let ok = 0;

  for (const r of rows) {
    const slug = slugFromSourceUrl(r.source_url);
    if (!slug) continue;

    const roles = [
      { key: "image_obverse", suffix: "obv" },
      { key: "image_reverse", suffix: "rev" },
      { key: "image_box", suffix: "box" },
      { key: "image_certificate", suffix: "cert" },
    ];

    let rowOk = true;
    const updates = {};
    for (const { key, suffix } of roles) {
      const val = r[key];
      const expectedPath = `/image/coins/foreign/${slug}-${suffix}.webp`;
      const fileExists = fs.existsSync(path.join(publicDir, expectedPath.replace(/^\//, "")));
      const hasSlug = val && String(val).includes(slug);

      if (!val) continue;
      if (!hasSlug) {
        rowOk = false;
        problems.push({
          id: r.id,
          catalog: r.catalog_number,
          title: (r.title || "").slice(0, 55),
          slug,
          role: suffix,
          current: val,
          expected: expectedPath,
          fileExists,
        });
        if (fixMode && fileExists) updates[key] = expectedPath;
      } else if (!fileExists) {
        problems.push({
          id: r.id,
          catalog: r.catalog_number,
          slug,
          role: suffix,
          current: val,
          expected: expectedPath,
          fileExists: false,
          msg: "path contains slug but file missing",
        });
        rowOk = false;
      }
    }
    if (Object.keys(updates).length) toUpdate.push({ id: r.id, updates });
    if (rowOk) ok++;
  }

  if (fixMode && toUpdate.length) {
    for (const { id, updates } of toUpdate) {
      const setClause = Object.entries(updates).map(([k, v]) => `${k} = ?`).join(", ");
      const vals = Object.values(updates);
      await conn.execute(`UPDATE coins SET ${setClause} WHERE id = ?`, [...vals, id]);
    }
    console.log("Обновлено записей в БД:", toUpdate.length);
  }
  await conn.end();

  console.log("Монет Perth по source_url (perthmint.com):", rows.length);
  console.log("Все картинки по slug:", ok);
  console.log("Проблем (путь не по slug или файл отсутствует):", problems.length);

  if (problems.length) {
    console.log("\n--- Детали (первые 40) ---");
    problems.slice(0, 40).forEach((p) => {
      console.log(`id=${p.id} ${p.catalog} [${p.role}] slug=${p.slug}`);
      console.log(`  текущий: ${p.current}`);
      console.log(`  ожидаемый: ${p.expected}  файл: ${p.fileExists ? "есть" : "НЕТ"}`);
      if (p.msg) console.log(`  ${p.msg}`);
    });
    if (problems.length > 40) console.log("... и ещё", problems.length - 40);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
