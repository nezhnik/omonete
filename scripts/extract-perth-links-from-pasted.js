/**
 * Извлекает ссылки на монеты Perth Mint из вставленного HTML.
 * Вставьте HTML в data/perth-mint-page-pasted.html и запустите:
 *   node scripts/extract-perth-links-from-pasted.js
 */
const fs = require("fs");
const path = require("path");

const PASTED_FILE = path.join(__dirname, "..", "data", "perth-mint-page-pasted.html");
const URL_LIST_FILE = path.join(__dirname, "perth-mint-urls.txt");

function isCoinLink(href) {
  if (!href || href.includes("?")) return false;
  if (href.includes("/shop/collector-coins/coins/")) return true;
  const m = href.match(/\/shop\/collector-coins\/([^/?#]+)/);
  return !!(m && m[1]);
}

function extractLinks(html) {
  const hrefs = new Set();
  const base = "https://www.perthmint.com";
  // Ищем всё после href=" до следующей "
  const re = /href="([^"]+)"/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    let h = m[1].trim();
    if (h.startsWith("/")) h = base + h;
    else if (!h.startsWith("http")) h = base + "/" + h;
    h = h.replace(/\/$/, "") || h;
    if (isCoinLink(h)) hrefs.add(h);
  }
  return Array.from(hrefs).filter(Boolean);
}

function main() {
  if (!fs.existsSync(PASTED_FILE)) {
    console.error("Файл не найден:", PASTED_FILE);
    console.log("Создайте файл, вставьте HTML и запустите снова.");
    process.exit(1);
  }
  const html = fs.readFileSync(PASTED_FILE, "utf8");
  const links = extractLinks(html);
  if (links.length === 0) {
    console.log("Ссылок не найдено. Проверьте, что в файле есть HTML страницы каталога Perth Mint.");
    process.exit(1);
  }
  console.log("Извлечено ссылок:", links.length);

  const existing = fs.existsSync(URL_LIST_FILE)
    ? fs.readFileSync(URL_LIST_FILE, "utf8").split(/\r?\n/).map((s) => s.trim()).filter((s) => s.startsWith("http"))
    : [];
  const normalize = (u) => (u.replace(/\/$/, "") || u);
  const existingNorm = new Set(existing.map(normalize));
  const newLinks = links.filter((u) => !existingNorm.has(normalize(u)));
  console.log("Новых (не было в списке):", newLinks.length);

  if (newLinks.length > 0) {
    const withSlash = (u) => (u.endsWith("/") ? u : u + "/");
    fs.appendFileSync(URL_LIST_FILE, "\n# Вручную из pasted\n" + newLinks.map(withSlash).join("\n") + "\n", "utf8");
    console.log("Добавлено в", URL_LIST_FILE);
  } else {
    console.log("Все ссылки уже есть в списке.");
  }
}

main();
