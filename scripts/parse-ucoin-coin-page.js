/**
 * Парсит страницу серии монет с ucoin.net.
 * Сайт под Cloudflare — прямой fetch не работает. Используем локально сохранённый HTML.
 *
 * Как получить HTML:
 * 1. Откройте страницу в браузере: https://ru.ucoin.net/coin/usa-1-dollar-1986-2021/?tid=16895
 * 2. Дождитесь полной загрузки (все варианты по годам)
 * 3. Ctrl+U или «Просмотр кода страницы» → Ctrl+A → Ctrl+C → вставьте в файл
 *    Или: «Сохранить как» → «Веб-страница, полностью» → сохраните .html
 *
 * Запуск:
 *   node scripts/parse-ucoin-coin-page.js <путь-к-html>
 *   node scripts/parse-ucoin-coin-page.js data/ucoin-usa-ase-1986-2021.html
 *
 * Выход: data/foreign-coins-ucoin-parsed.csv (колонки как у российских монет)
 */
const fs = require("fs");
const path = require("path");

const HTML_PATH = process.argv[2];
const OUT_CSV = path.join(__dirname, "..", "data", "foreign-coins-ucoin-parsed.csv");
const DELIM = "\t";

// Только дворы и металлы из нашей системы
const OUR_MINTS = new Set([
  "Монетный двор США",
  "Королевский монетный двор Великобритании",
  "Королевский канадский монетный двор",
  "Австрийский монетный двор",
  "Южноафриканский монетный двор",
  "United States Mint",
  "The Royal Mint",
  "Royal Canadian Mint",
  "Austrian Mint",
  "South African Mint",
]);
const OUR_METALS = new Set(["серебро", "золото", "платина", "палладий", "медь"]);

function normalizeMetal(str) {
  if (!str || typeof str !== "string") return null;
  const m = str.toLowerCase().trim();
  for (const metal of OUR_METALS) {
    if (m.includes(metal)) return metal.charAt(0).toUpperCase() + metal.slice(1);
  }
  return null;
}

/**
 * Ищем в HTML блоки вариантов: год, тираж, возможно качество (Пруф/АЦ), изображения.
 * Структура ucoin может быть: таблица, div-сетка, или data в JSON.
 */
function parseVariants(html) {
  const variants = [];
  // Типичные паттерны: год в td/data-year, тираж в data-mintage или рядом с числом
  // Изображения: img src с obverse/reverse
  const yearRe = /(?:year|год|г\.?)\s*[:\s]*(\d{4})/gi;
  const mintageRe = /(?:mintage|тираж|выпуск)\s*[:\s]*([\d\s]+)/gi;
  // Ищем блоки типа: год + тираж + картинка
  const blocks = html.split(/<tr|<div[^>]*class="[^"]*coin[^"]*"|data-year|data-variant/gi);
  let yearMatches = [...html.matchAll(/\b(19\d{2}|20\d{2})\b/g)];
  const years = [...new Set(yearMatches.map((m) => m[1]).filter((y) => y >= 1986 && y <= 2030))];

  // Попробуем найти таблицу вариантов — часто структура: строка = год, ячейки = тираж, качество
  const tableMatch = html.match(/<table[^>]*>[\s\S]*?<\/table>/gi);
  const imgMatches = html.matchAll(/<img[^>]+src="([^"]+)"[^>]*>/gi);
  const images = [...imgMatches].map((m) => m[1]).filter((u) => u.includes("ucoin") || u.includes("cloudflare"));

  // Альтернатива: ищем JSON в script
  const jsonMatch = html.match(/window\.__DATA__\s*=\s*({[\s\S]*?});/);
  if (jsonMatch) {
    try {
      const data = JSON.parse(jsonMatch[1]);
      if (data.variants) return parseFromJson(data);
    } catch {}
  }

  // Fallback: если есть years и общие данные серии — создаём по одному варианту на год
  const seriesTitle = html.match(/<h1[^>]*>([^<]+)<\/h1>/i)?.[1]?.trim() || "American Silver Eagle";
  const metalStr = html.match(/(?:серебро|silver|металл|composition)[^<]*/i)?.[0] || "";
  const metal = normalizeMetal(metalStr) || "Серебро";
  const faceValue = html.match(/(\d+\s*(?:доллар|dollar|долл\.?))/i)?.[1] || "1 доллар";

  if (years.length === 0) {
    console.warn("⚠ Годы не найдены. Проверьте HTML или передайте вручную.");
  }

  for (const year of years.sort()) {
    variants.push({
      title: `${seriesTitle} ${year}`,
      series: seriesTitle,
      country: "США",
      face_value: faceValue,
      release_date: `${year}-01-01`,
      mint: "Монетный двор США",
      mint_short: "US Mint",
      metal,
      metal_fineness: "999/1000",
      mintage: "",
      mintage_display: "",
      weight_g: "31,1035",
      weight_oz: "1 унция",
      catalog_number: `US-ASE-${year}`,
      catalog_suffix: String(year).slice(-2),
      quality: "",
      diameter_mm: "40,6",
      thickness_mm: "2,98",
      image_obverse: "",
      image_reverse: "",
      _source: "parsed",
      _needsReview: true,
    });
  }

  return variants;
}

function parseFromJson(data) {
  const out = [];
  for (const v of data.variants || []) {
    const metal = normalizeMetal(v.composition || v.metal) || "Серебро";
    out.push({
      title: v.title || v.name,
      series: v.series || data.series,
      country: v.country || "США",
      face_value: v.face_value || v.denomination || "1 доллар",
      release_date: v.year ? `${v.year}-01-01` : "",
      mint: "Монетный двор США",
      mint_short: "US Mint",
      metal,
      metal_fineness: v.fineness || "999/1000",
      mintage: v.mintage || "",
      mintage_display: v.mintage_display || "",
      weight_g: v.weight_g || "31,1035",
      weight_oz: v.weight_oz || "1 унция",
      catalog_number: v.catalog_number || v.uc || "",
      quality: v.quality || v.quality_en || "",
      diameter_mm: v.diameter_mm || "40,6",
      image_obverse: v.image_obverse || v.obverse || "",
      image_reverse: v.image_reverse || v.reverse || "",
      _source: "json",
      _needsReview: false,
    });
  }
  return out;
}

function toCsvRow(v) {
  const cols = [
    "title",
    "series",
    "country",
    "face_value",
    "release_date",
    "mint",
    "mint_short",
    "metal",
    "metal_fineness",
    "mintage",
    "mintage_display",
    "weight_g",
    "weight_oz",
    "catalog_number",
    "catalog_suffix",
    "quality",
    "diameter_mm",
    "thickness_mm",
    "length_mm",
    "width_mm",
    "image_obverse",
    "image_reverse",
  ];
  return cols
    .map((c) => {
      const val = v[c];
      if (val == null || val === "") return "";
      return String(val).replace(/\t/g, " ").replace(/\n/g, " ");
    })
    .join(DELIM);
}

function dumpStructure(html) {
  const outPath = path.join(__dirname, "..", "data", "ucoin-page-structure.txt");
  const excerpts = [];
  if (html.includes("__DATA__")) excerpts.push("Найден window.__DATA__ (JSON)");
  if (html.includes("data-year")) excerpts.push("Найдены data-year");
  if (html.includes("data-mintage")) excerpts.push("Найдены data-mintage");
  const tables = html.match(/<table[^>]*class="[^"]*"[^>]*>/gi);
  if (tables) excerpts.push(`Таблицы: ${tables.length}`);
  const imgs = html.match(/<img[^>]+src="[^"]+"/gi)?.length || 0;
  excerpts.push(`Изображений img: ${imgs}`);
  fs.writeFileSync(outPath, excerpts.join("\n") + "\n\n--- Первые 8000 символов ---\n" + html.slice(0, 8000), "utf8");
  console.log("Структура страницы сохранена в", outPath, "— можно проверить и доработать парсер.");
}

function main() {
  if (!HTML_PATH || !fs.existsSync(HTML_PATH)) {
    console.error("Использование: node scripts/parse-ucoin-coin-page.js <путь-к-html>");
    console.error("Пример: node scripts/parse-ucoin-coin-page.js data/ucoin-usa-ase.html");
    console.error("\nСохраните страницу в браузере (Ctrl+S) и укажите путь к файлу.");
    process.exit(1);
  }

  const html = fs.readFileSync(HTML_PATH, "utf8");

  if (process.argv.includes("--debug")) {
    dumpStructure(html);
  }

  const variants = parseVariants(html);

  const header =
    "title\tseries\tcountry\tface_value\trelease_date\tmint\tmint_short\tmetal\tmetal_fineness\tmintage\tmintage_display\tweight_g\tweight_oz\tcatalog_number\tcatalog_suffix\tquality\tdiameter_mm\tthickness_mm\tlength_mm\twidth_mm\timage_obverse\timage_reverse";
  const rows = variants.map(toCsvRow);
  const csv = [header, ...rows].join("\n");

  const outDir = path.dirname(OUT_CSV);
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(OUT_CSV, csv, "utf8");

  console.log("✓ Распознано вариантов:", variants.length);
  console.log("✓ Записано в:", OUT_CSV);
  if (variants.some((v) => v._needsReview)) {
    console.log("\n⚠ Часть записей помечена _needsReview — проверьте тиражи и качество чеканки по фотографиям.");
  }
}

main();
