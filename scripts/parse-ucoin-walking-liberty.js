/**
 * Парсер ucoin.net: American Silver Eagle, серебро США.
 * Страница: https://ru.ucoin.net/coin/usa-1-dollar-1986-2021/?tid=16895
 * Парсит таблицу «Тираж, Стоимость»: Год | Знак | Unc | BU | Proof
 *
 * Защита от блокировки: парсим только ЛОКАЛЬНЫЙ файл. Запросов к сайту нет.
 *
 * Как получить HTML:
 *   1. Откройте ссылку в браузере, дождитесь загрузки
 *   2. Ctrl+S → «Веб-страница, полностью» → data/ucoin-usa-1-dollar-1986-2021.html
 *
 * Запуск:
 *   node scripts/parse-ucoin-walking-liberty.js [путь-к-html]
 *   node scripts/ucoin-parse-preview.js  — сгенерировать тестовый HTML для проверки
 */
const fs = require("fs");
const path = require("path");

const DEFAULT_HTML = path.join(__dirname, "..", "data", "ucoin-usa-1-dollar-1986-2021.html");
const OUTPUT_CSV = path.join(__dirname, "..", "data", "foreign-coins-ase-parsed.csv");
const OUTPUT_JSON = path.join(__dirname, "..", "data", "walking-liberty-ucoin.json");
const OUTPUT_TEST_HTML = path.join(__dirname, "..", "data", "ucoin-parse-test.html");

// Подстановка тиражей из US Mint (Wikipedia cites US Mint + Red Book)
// Источник: https://en.wikipedia.org/wiki/American_Silver_Eagle_mintage_figures
const US_MINT_OVERRIDES = {
  "US-ASE-2021-BU": { mintage: "28274500", mintage_display: "28 274 500" },
  "US-ASE-2021-S-P": { mintage: "274536", mintage_display: "274 536" },
  "US-ASE-2021-W-P": { mintage: "416047", mintage_display: "416 047" },
  "US-ASE-2019-S-P": { mintage: "202206", mintage_display: "202 206" },
  "US-ASE-2019-W-P": { mintage: "410334", mintage_display: "410 334" },
  "US-ASE-2014-W-P": { mintage: "944757", mintage_display: "944 757" },
};

// Знаки дворов USA: P=Philadelphia, S=San Francisco, W=West Point
const MINT_NAMES = {
  P: "Филадельфия",
  S: "Сан-Франциско",
  W: "Вест-Поинт",
  "": "Монетный двор США",
};

// Unc/BU → АЦ, Proof → Пруф (как в foreign-coins-test.csv)
function toQuality(unc, bu, proof) {
  const uncVal = (unc || "").trim();
  const buVal = (bu || "").trim();
  const proofVal = (proof || "").trim();
  if (proofVal && proofVal !== "-") return "Пруф";
  if (buVal && buVal !== "-") return "АЦ";
  if (uncVal && uncVal !== "-") return "АЦ";
  return "";
}

function parseMintageVal(val) {
  if (!val || val === "-") return { mintage: "", mintage_display: "" };
  if (val === "+") return { mintage: "", mintage_display: "есть" };
  const num = val.replace(/\s/g, "").replace(/\./g, "").replace(/,/g, "");
  const display = val.replace(/\./g, " ");
  return { mintage: num, mintage_display: display };
}

/** Парсим таблицу Тираж: каждая строка — год, знак, Unc, BU, Proof. Если в строке несколько колонок с тиражем — создаём отдельную монету на каждую. */
function parseSeriesPage(html) {
  const coins = [];
  if (html.includes("Just a moment") || html.includes("Выполнение проверки") || html.includes("Один момент")) {
    return { coins, cloudflare: true };
  }

  const rowRegex = /<tr>\s*<td><strong>(\d{4})<\/strong><\/td>\s*<td>([^<]*)<\/td>\s*<td>([^<]*)<\/td>\s*<td>([^<]*)<\/td>\s*<td>([^<]*)<\/td>\s*<\/tr>/g;
  let m;
  while ((m = rowRegex.exec(html)) !== null) {
    const [, year, signRaw, unc, bu, proof] = m;
    const sign = (signRaw || "").trim();
    const mintShort = sign ? (sign === "P" ? "Philadelphia" : sign === "S" ? "San Francisco" : sign === "W" ? "West Point" : sign) : "US Mint";
    const mint = MINT_NAMES[sign] || "Монетный двор США";

    const variants = [];
    if ((unc || "").trim() && (unc || "").trim() !== "-") variants.push({ quality: "АЦ", ...parseMintageVal(unc) });
    if ((bu || "").trim() && (bu || "").trim() !== "-") variants.push({ quality: "АЦ", ...parseMintageVal(bu) });
    if ((proof || "").trim() && (proof || "").trim() !== "-") variants.push({ quality: "Пруф", ...parseMintageVal(proof) });

    if (variants.length === 0) continue;

    for (const v of variants) {
      const catalog_number = `US-ASE-${year}${sign ? `-${sign}` : ""}-${v.quality === "Пруф" ? "P" : "BU"}`;
      let mintage = v.mintage;
      let mintage_display = v.mintage_display;
      if (mintage_display === "есть" && US_MINT_OVERRIDES[catalog_number]) {
        mintage = US_MINT_OVERRIDES[catalog_number].mintage;
        mintage_display = US_MINT_OVERRIDES[catalog_number].mintage_display;
      }
      const titleRu = `Американский серебряный орёл ${year}${sign ? ` (${sign})` : ""}`;
      const titleEn = `American Silver Eagle ${year}${sign ? ` (${sign})` : ""}`;
      coins.push({
        title: titleRu,
        title_en: titleEn,
        series: "American Eagle",
        metal: "Серебро",
        metalFineness: "999/1000",
        metal_fineness: "999/1000",
        weightG: "31,1035",
        weight_g: "31,1035",
        weightOz: "1 унция",
        weight_oz: "1 унция",
        faceValue: "1 доллар",
        face_value: "1 доллар",
        country: "США",
        mint,
        mintShort,
        mint_short: mintShort,
        diameterMm: "40,6",
        diameter_mm: "40,6",
        thicknessMm: "2,98",
        thickness_mm: "2,98",
        release_date: `${year}-01-01`,
        catalog_number,
        catalog_suffix: String(year).slice(-2) + (sign || ""),
        mintage,
        mintage_display,
        quality: v.quality,
        image_obverse: "",
        image_reverse: "",
      });
    }
  }

  return { coins, cloudflare: false };
}

function toCsvRow(c) {
  const cols = [
    "title", "title_en", "series", "country", "face_value", "release_date", "mint", "mint_short",
    "metal", "metal_fineness", "mintage", "mintage_display", "weight_g", "weight_oz",
    "catalog_number", "catalog_suffix", "quality", "diameter_mm", "thickness_mm",
    "length_mm", "width_mm", "image_obverse", "image_reverse",
  ];
  return cols.map((k) => (c[k] || "").replace(/\t/g, " ")).join("\t");
}

function run(htmlPath) {
  if (!fs.existsSync(htmlPath)) {
    console.error("Файл не найден:", htmlPath);
    console.error("\nСохраните страницу вручную:");
    console.error("  1. Откройте https://ru.ucoin.net/coin/usa-1-dollar-1986-2021/?tid=16895");
    console.error("  2. Ctrl+S → сохраните как data/ucoin-usa-1-dollar-1986-2021.html");
    console.error("  3. Запустите: node scripts/parse-ucoin-walking-liberty.js");
    return null;
  }

  const html = fs.readFileSync(htmlPath, "utf8");
  const { coins, cloudflare } = parseSeriesPage(html);

  if (cloudflare) {
    console.error("В файле страница Cloudflare — сохраните страницу после полной загрузки в браузере.");
    return null;
  }

  const header = "title\ttitle_en\tseries\tcountry\tface_value\trelease_date\tmint\tmint_short\tmetal\tmetal_fineness\tmintage\tmintage_display\tweight_g\tweight_oz\tcatalog_number\tcatalog_suffix\tquality\tdiameter_mm\tthickness_mm\tlength_mm\twidth_mm\timage_obverse\timage_reverse";
  const csv = [header, ...coins.map(toCsvRow)].join("\n");

  const outDir = path.dirname(OUTPUT_CSV);
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(OUTPUT_CSV, csv, "utf8");
  fs.writeFileSync(OUTPUT_JSON, JSON.stringify({ meta: { parsedAt: new Date().toISOString(), source: htmlPath }, coins }, null, 2), "utf8");

  console.log("✓ Распознано записей:", coins.length);
  console.log("✓ CSV:", OUTPUT_CSV);
  console.log("✓ JSON:", OUTPUT_JSON);
  return coins;
}

if (require.main === module) {
  const htmlPath = process.argv[2] || DEFAULT_HTML;
  run(htmlPath);
}

module.exports = { parseSeriesPage, run, OUTPUT_TEST_HTML };
