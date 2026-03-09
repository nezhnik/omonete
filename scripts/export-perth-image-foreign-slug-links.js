/**
 * Экспорт ссылок на монеты, у которых картинки Perth выглядят подозрительно
 * (путь не содержит slug монеты).
 *
 * Использует тот же критерий, что validate-perth-images.ts, но дополнительно:
 *  - сопоставляет Perth JSON с нашим public/data/coins по catalogSuffix;
 *  - для каждой проблемной картинки добавляет ссылку вида
 *      http://localhost:3000/coins/<id>/
 *
 * Результат пишет в:
 *   data/perth-image-foreign-slug-links.txt
 */

const fs = require("fs");
const path = require("path");

const DATA_DIR = path.join(__dirname, "..", "data");
const PUBLIC_COINS_DIR = path.join(__dirname, "..", "public", "data", "coins");

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

function buildCatalogSuffixToIdMap() {
  const map = new Map();
  const files = fs.readdirSync(PUBLIC_COINS_DIR).filter((f) => f.endsWith(".json"));
  for (const f of files) {
    const full = path.join(PUBLIC_COINS_DIR, f);
    const j = JSON.parse(fs.readFileSync(full, "utf8"));
    const c = j.coin || {};
    if (!c.catalogSuffix) continue;
    map.set(String(c.catalogSuffix).toLowerCase(), String(c.id));
  }
  return map;
}

function main() {
  const suffixToId = buildCatalogSuffixToIdMap();
  const files = fs
    .readdirSync(DATA_DIR)
    .filter((f) => f.startsWith("perth-mint-") && f.endsWith(".json"));

  const lines = [];

  for (const f of files) {
    const full = path.join(DATA_DIR, f);
    const raw = JSON.parse(fs.readFileSync(full, "utf8"));
    const coin = raw.coin || {};
    const sourceUrl = coin.source_url;
    if (!sourceUrl || !sourceUrl.includes("perthmint.com")) continue;
    const slug = slugFromSourceUrl(sourceUrl);
    const suffix = coin.catalog_suffix || coin.catalogSuffix;
    const id = suffix ? suffixToId.get(String(suffix).toLowerCase()) : undefined;

    const roles = [
      { key: "image_obverse", label: "obv" },
      { key: "image_reverse", label: "rev" },
      { key: "image_box", label: "box" },
      { key: "image_certificate", label: "cert" },
    ];
    for (const { key, label } of roles) {
      const val = coin[key];
      if (!val) continue;
      if (!slug || String(val).includes(slug)) continue;
      const url = id ? `http://localhost:3000/coins/${id}/` : "(id не найден)";
      lines.push(
        [
          `file=${f}`,
          `role=${label}`,
          `slug=${slug}`,
          `path=${val}`,
          suffix ? `suffix=${suffix}` : "",
          id ? `id=${id}` : "",
          `link=${url}`,
        ]
          .filter(Boolean)
          .join(" | ")
      );
    }
  }

  const outPath = path.join(DATA_DIR, "perth-image-foreign-slug-links.txt");
  fs.writeFileSync(outPath, lines.join("\n"), "utf8");
  console.log(`Сохранено ${lines.length} строк в ${path.relative(process.cwd(), outPath)}`);
}

main();

