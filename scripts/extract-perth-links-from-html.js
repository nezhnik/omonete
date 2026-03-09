/**
 * Извлекает ссылки из сохранённых HTML. Не обращается к сайту — всё локально.
 * Источники:
 *   data/perth-listing-page-1.html … page-27.html — от fetch-perth-listing-to-html.js
 *   data/perth-mint-page-pasted.html              — ручная вставка (если listing не сохранён)
 *
 *   node scripts/extract-perth-links-from-html.js           — извлечь, сравнить, показать недостающие
 *   node scripts/extract-perth-links-from-html.js --merge   — и добавить недостающие в perth-mint-urls.txt
 *   node scripts/extract-perth-links-from-html.js --stats   — подсчёт по страницам (36 карточек/стр, ~936–940 всего)
 */
const fs = require("fs");
const path = require("path");

const DATA_DIR = path.join(__dirname, "..", "data");
const URL_LIST_FILE = path.join(__dirname, "perth-mint-urls.txt");

function isCoinLink(href) {
  if (!href || href.includes("?")) return false;
  if (href.includes("/shop/collector-coins/coins/")) return true;
  if (href.includes("/shop/collector-coins/coin-sets/")) return true;
  const m = href.match(/\/shop\/collector-coins\/([^/?#]+)\//);
  return !!(m && m[1]);
}

/** Извлекает ссылки из product cards. Если карточек нет (страница без JS) — fallback на все href. */
function extractLinksFromHtml(html) {
  const base = "https://www.perthmint.com";
  const hrefs = new Set();
  const cardRegex = /<div[^>]*class="[^"]*product-list__product[^"]*"[^>]*>[\s\S]*?<a\s+href="([^"]+)"/g;
  let m;
  while ((m = cardRegex.exec(html)) !== null) {
    let h = m[1].trim();
    if (h.startsWith("/")) h = base + h;
    else if (!h.startsWith("http")) h = base + "/" + h;
    h = h.replace(/\/$/, "") || h;
    if (isCoinLink(h)) hrefs.add(h);
  }
  if (hrefs.size === 0) {
    const re = /href="([^"]+)"/gi;
    while ((m = re.exec(html)) !== null) {
      let h = m[1].trim();
      if (h.startsWith("/")) h = base + h;
      else if (!h.startsWith("http")) h = base + "/" + h;
      h = h.replace(/\/$/, "") || h;
      if (isCoinLink(h)) hrefs.add(h);
    }
  }
  return hrefs;
}

function main() {
  const merge = process.argv.includes("--merge");
  let files = fs.readdirSync(DATA_DIR).filter((f) => /^perth-listing-page-\d+\.html$/.test(f)).sort((a, b) => {
    const na = parseInt(a.match(/\d+/)[0], 10);
    const nb = parseInt(b.match(/\d+/)[0], 10);
    return na - nb;
  });
  // Ручная вставка — тоже подходит
  const pasted = path.join(DATA_DIR, "perth-mint-page-pasted.html");
  if (files.length === 0 && fs.existsSync(pasted)) {
    files = ["perth-mint-page-pasted.html"];
    console.log("Используется ручная вставка perth-mint-page-pasted.html");
  }

  if (files.length === 0) {
    console.log("Нет файлов perth-listing-page-*.html. Сначала:");
    console.log("  node scripts/fetch-perth-listing-to-html.js");
    process.exit(1);
  }

  const allLinks = new Set();
  const perPage = {};
  files.forEach((f) => {
    const html = fs.readFileSync(path.join(DATA_DIR, f), "utf8");
    const links = extractLinksFromHtml(html);
    perPage[f] = links.size;
    links.forEach((u) => allLinks.add(u));
  });
  if (process.argv.includes("--stats")) {
    console.log("\nПо страницам:");
    Object.entries(perPage).forEach(([f, n]) => console.log("  ", f, "→", n));
  }

  const normalize = (u) => (u.replace(/\/$/, "") || u);
  const canonical = (u) => (u.endsWith("/") ? u : u + "/");
  const fromHtml = Array.from(allLinks).map(canonical);

  const existing = fs.existsSync(URL_LIST_FILE)
    ? fs.readFileSync(URL_LIST_FILE, "utf8").split(/\r?\n/).map((s) => s.trim()).filter((s) => s.startsWith("http"))
    : [];
  const existingNorm = new Set(existing.map(normalize));
  const missing = fromHtml.filter((u) => !existingNorm.has(normalize(u)));

  console.log("Файлов HTML:", files.length);
  console.log("Ссылок из HTML:", fromHtml.length);
  console.log("В нашем списке:", existing.length);
  console.log("Недостающих:", missing.length);

  if (missing.length > 0) {
    console.log("\nНедостающие ссылки:");
    missing.forEach((u) => console.log(" ", u));
    if (merge) {
      fs.appendFileSync(URL_LIST_FILE, "\n# Из HTML " + new Date().toISOString().slice(0, 10) + "\n" + missing.join("\n") + "\n", "utf8");
      console.log("\nДобавлено в", URL_LIST_FILE);
    } else {
      console.log("\nЧтобы добавить: node scripts/extract-perth-links-from-html.js --merge");
    }
  } else {
    console.log("\nНедостающих нет — список полный.");
  }
}

main();
