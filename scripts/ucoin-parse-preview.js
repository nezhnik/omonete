/**
 * Генерирует тестовый HTML с таблицей распарсенных монет.
 * Сравни с исходной страницей ucoin — все ли поля заполнились.
 *
 * Запуск:
 *   node scripts/parse-ucoin-walking-liberty.js "путь/к/странице.html"
 *   node scripts/ucoin-parse-preview.js
 *
 * Открой data/ucoin-parse-test.html в браузере.
 */
const fs = require("fs");
const path = require("path");
const { run, OUTPUT_TEST_HTML } = require("./parse-ucoin-walking-liberty.js");

const HTML_PATH = process.argv[2] || path.join(__dirname, "..", "data", "ucoin-usa-1-dollar-1986-2021.html");
const SAVED_PAGE = "/Users/mihail/Desktop/1 доллар 1986-2021 - Американский серебряный орёл, США.html";

function generateTestHtml(coins) {
  const fields = [
    { key: "title", label: "Название" },
    { key: "series", label: "Серия" },
    { key: "country", label: "Страна" },
    { key: "face_value", label: "Номинал" },
    { key: "release_date", label: "Дата выпуска" },
    { key: "mint", label: "Монетный двор" },
    { key: "mintShort", label: "Двор (коротко)" },
    { key: "metal", label: "Металл" },
    { key: "metalFineness", label: "Проба" },
    { key: "mintage", label: "Тираж (число)" },
    { key: "mintage_display", label: "Тираж (отображение)" },
    { key: "weightG", label: "Вес (г)" },
    { key: "weightOz", label: "Вес (унция)" },
    { key: "catalog_number", label: "Каталог №" },
    { key: "quality", label: "Качество" },
    { key: "diameterMm", label: "Диаметр (мм)" },
    { key: "thicknessMm", label: "Толщина (мм)" },
    { key: "image_obverse", label: "Аверс" },
    { key: "image_reverse", label: "Реверс" },
  ];

  const rows = coins
    .map(
      (c) => `
    <tr>
      ${fields
        .map(
          (f) => `
      <td class="${!c[f.key] ? "empty" : ""}" title="${f.label}">${escapeHtml(String(c[f.key] || "—"))}</td>`
        )
        .join("")}
    </tr>`
    )
    .join("");

  return `<!DOCTYPE html>
<html lang="ru">
<head>
  <meta charset="UTF-8">
  <title>Проверка парсера ucoin — ASE</title>
  <style>
    * { box-sizing: border-box; }
    body { font: 14px/1.4 sans-serif; padding: 16px; background: #f5f5f5; }
    h1 { margin: 0 0 8px; }
    .meta { color: #666; font-size: 12px; margin-bottom: 16px; }
    table { border-collapse: collapse; background: #fff; box-shadow: 0 1px 3px rgba(0,0,0,.1); }
    th, td { border: 1px solid #ddd; padding: 6px 10px; text-align: left; font-size: 12px; }
    th { background: #333; color: #fff; font-weight: 600; }
    tr:nth-child(even) { background: #f9f9f9; }
    td.empty { background: #fff3cd; color: #856404; }
    .legend { margin-top: 16px; font-size: 12px; color: #666; }
    .legend span { display: inline-block; padding: 2px 8px; margin-right: 8px; background: #fff3cd; }
  </style>
</head>
<body>
  <h1>Результат парсинга ucoin: American Silver Eagle</h1>
  <p class="meta">Записей: ${coins.length} | Сравните с таблицей на исходной странице ucoin</p>
  <div style="overflow-x: auto;">
    <table>
      <thead><tr>${fields.map((f) => `<th>${f.label}</th>`).join("")}</tr></thead>
      <tbody>${rows}</tbody>
    </table>
  </div>
  <p class="legend"><span>Жёлтый</span> — поле пустое (проверьте, должно ли быть заполнено)</p>
</body>
</html>`;
}

function escapeHtml(s) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

const OUTPUT_JSON = path.join(__dirname, "..", "data", "walking-liberty-ucoin.json");

function main() {
  let coins;
  if (fs.existsSync(OUTPUT_JSON)) {
    const data = JSON.parse(fs.readFileSync(OUTPUT_JSON, "utf8"));
    coins = data.coins || [];
    console.log("✓ Загружено из JSON:", coins.length, "монет");
  } else {
    const htmlPath = fs.existsSync(SAVED_PAGE) ? SAVED_PAGE : process.argv[2] || HTML_PATH;
    if (!htmlPath || !fs.existsSync(htmlPath)) {
      console.error("Нет данных. Сначала запустите парсер:");
      console.error("  node scripts/parse-ucoin-walking-liberty.js путь/к/странице.html");
      process.exit(1);
    }
    coins = run(htmlPath);
  }
  if (!coins || coins.length === 0) process.exit(1);

  const outDir = path.dirname(OUTPUT_TEST_HTML);
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(OUTPUT_TEST_HTML, generateTestHtml(coins), "utf8");
  console.log("✓ Тестовый HTML:", OUTPUT_TEST_HTML);
  console.log("  Откройте в браузере и сверьте с исходной таблицей ucoin.");
}

main();
