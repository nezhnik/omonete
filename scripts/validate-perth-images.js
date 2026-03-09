/**
 * Валидация картинок Perth:
 *  - проверяем, что все coin.image_* (obv/rev/box/cert), если заданы,
 *    существуют на диске и содержат slug монеты.
 *
 * Это не меняет данные, только даёт отчёт:
 *  - missingFile: есть путь, но файла нет
 *  - foreignSlug: путь есть, но НЕ содержит slug монеты (подозрительно)
 *
 * Запуск:
 *   node scripts/validate-perth-images.js
 */

const fs = require("fs");
const path = require("path");

const DATA_DIR = path.join(__dirname, "..", "data");
const PUBLIC_DIR = path.join(__dirname, "..", "public");

function slugFromSourceUrl(url) {
  if (!url) return null;
  const pathname = String(url).replace(/^https?:\/\/[^/]+/, "").replace(/\?.*$/, "").replace(/\/$/, "");
  const segments = pathname.split("/").filter(Boolean);
  const last = segments[segments.length - 1] || "perth-coin";
  return (
    last
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "") || "perth-coin"
  );
}

function main() {
  const files = fs
    .readdirSync(DATA_DIR)
    .filter((f) => f.startsWith("perth-mint-") && f.endsWith(".json"));

  const problems = {
    missingFile: [],
    foreignSlug: [],
  };

  for (const f of files) {
    const full = path.join(DATA_DIR, f);
    const raw = JSON.parse(fs.readFileSync(full, "utf8"));
    const coin = raw.coin || {};
    const sourceUrl = coin.source_url;
    if (!sourceUrl || !sourceUrl.includes("perthmint.com")) continue;
    const slug = slugFromSourceUrl(sourceUrl);
    const roles = [
      { key: "image_obverse", label: "obv" },
      { key: "image_reverse", label: "rev" },
      { key: "image_box", label: "box" },
      { key: "image_certificate", label: "cert" },
    ];
    for (const { key, label } of roles) {
      const val = coin[key];
      if (!val) continue;
      const rel = String(val).replace(/^\/+/, "");
      const filePath = path.join(PUBLIC_DIR, rel);
      if (!fs.existsSync(filePath)) {
        problems.missingFile.push({ file: f, role: label, path: val });
      } else if (slug && !String(val).includes(slug)) {
        problems.foreignSlug.push({ file: f, role: label, path: val, slug });
      }
    }
  }

  console.log("Проблемы с картинками Perth:");
  console.log("  missingFile:", problems.missingFile.length);
  console.log("  foreignSlug:", problems.foreignSlug.length);

  if (problems.missingFile.length) {
    console.log("\nmissingFile (первые 20):");
    problems.missingFile.slice(0, 20).forEach((p) => {
      console.log(`  ${p.file} [${p.role}]: ${p.path}`);
    });
  }
  if (problems.foreignSlug.length) {
    console.log("\nforeignSlug (первые 20):");
    problems.foreignSlug.slice(0, 20).forEach((p) => {
      console.log(`  ${p.file} [${p.role}] slug=${p.slug}: ${p.path}`);
    });
  }
}

main();

