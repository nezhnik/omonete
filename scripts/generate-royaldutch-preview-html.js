/**
 * Статическая страница-превью картинок Royal Dutch из data/royaldutch-mint-*.json.
 * Запуск: node scripts/generate-royaldutch-preview-html.js
 * Просмотр: npm run dev → http://localhost:3000/royaldutch-image-preview.html
 */
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const DATA_DIR = path.join(ROOT, "data");
const OUT = path.join(ROOT, "public", "royaldutch-image-preview.html");

function esc(s) {
  return String(s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/"/g, "&quot;");
}

function main() {
  const files = fs
    .readdirSync(DATA_DIR)
    .filter((f) => f.startsWith("royaldutch-mint-") && f.endsWith(".json") && !f.includes("listing-products"))
    .sort();

  const rows = [];
  for (const f of files) {
    let c;
    try {
      c = JSON.parse(fs.readFileSync(path.join(DATA_DIR, f), "utf8")).coin;
    } catch {
      continue;
    }
    if (!c || !c.slug) continue;
    const obv = c.image_obverse || "";
    const rev = c.image_reverse || "";
    rows.push({ slug: c.slug, title: c.title || c.slug, obv, rev, source: c.source_url || "" });
  }

  const cards = rows
    .map(
      (r) => `
    <article class="card">
      <h3>${esc(r.title)}</h3>
      <p class="meta"><code>${esc(r.slug)}</code></p>
      <div class="pair">
        <figure>
          <figcaption>obv</figcaption>
          ${r.obv ? `<img src="${esc(r.obv)}" alt="" loading="lazy" onerror="this.classList.add('broken')" />` : `<span class="missing">нет пути</span>`}
        </figure>
        <figure>
          <figcaption>rev</figcaption>
          ${r.rev ? `<img src="${esc(r.rev)}" alt="" loading="lazy" onerror="this.classList.add('broken')" />` : `<span class="missing">нет пути</span>`}
        </figure>
      </div>
      ${r.source ? `<p class="src"><a href="${esc(r.source)}" target="_blank" rel="noopener">Страница RDM</a></p>` : ""}
    </article>`
    )
    .join("\n");

  const html = `<!DOCTYPE html>
<html lang="ru">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Royal Dutch — превью картинок (${rows.length})</title>
  <style>
    body { font-family: system-ui, sans-serif; margin: 1rem; background: #f5f5f5; }
    h1 { font-size: 1.25rem; }
    .hint { color: #444; margin-bottom: 1rem; }
    .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(320px, 1fr)); gap: 1rem; }
    .card { background: #fff; border-radius: 8px; padding: 1rem; box-shadow: 0 1px 3px rgba(0,0,0,.08); }
    .card h3 { font-size: 0.95rem; margin: 0 0 0.5rem; line-height: 1.3; }
    .meta code { font-size: 0.75rem; word-break: break-all; }
    .pair { display: flex; gap: 0.75rem; flex-wrap: wrap; margin-top: 0.5rem; }
    figure { margin: 0; text-align: center; }
    figcaption { font-size: 0.7rem; color: #666; margin-bottom: 0.25rem; }
    img { max-width: 160px; max-height: 160px; width: auto; height: auto; object-fit: contain; background: #eee; border-radius: 4px; }
    img.broken { outline: 2px solid #c00; min-width: 80px; min-height: 80px; }
    .missing { color: #999; font-size: 0.8rem; }
    .src { font-size: 0.75rem; margin-top: 0.5rem; }
    .src a { color: #06c; }
  </style>
</head>
<body>
  <h1>Royal Dutch Mint — превью локальных webp</h1>
  <p class="hint">Карточек: <strong>${rows.length}</strong>. Запустите <code>npm run dev</code> и откройте эту страницу с того же хоста, иначе пути <code>/image/...</code> не сработают.</p>
  <p class="hint">Каталог сайта: <a href="/catalog">/catalog</a> — фильтр по минту в интерфейсе.</p>
  <div class="grid">
${cards}
  </div>
</body>
</html>`;

  fs.writeFileSync(OUT, html, "utf8");
  console.log("Записано:", OUT);
  console.log("Откройте: http://localhost:3000/royaldutch-image-preview.html (после npm run dev)");
}

main();
