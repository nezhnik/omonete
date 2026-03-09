/**
 * Удаляет дубликаты в perth-mint-urls.txt.
 * Один URL может быть с / и без — это одна страница. Оставляем с /.
 */
const fs = require("fs");
const path = require("path");

const URL_LIST_FILE = path.join(__dirname, "perth-mint-urls.txt");

function main() {
  const text = fs.readFileSync(URL_LIST_FILE, "utf8");
  const lines = text.split(/\r?\n/);
  const seen = new Set();
  const result = [];

  for (const line of lines) {
    if (line.startsWith("#") || !line.trim()) {
      result.push(line);
      continue;
    }
    const url = line.trim();
    if (!url.startsWith("http")) continue;
    const norm = url.replace(/\/$/, "") || url;
    if (seen.has(norm)) continue;
    seen.add(norm);
    result.push(url.endsWith("/") ? url : url + "/");
  }

  const urlsOnly = result.filter((l) => l.startsWith("http"));
  fs.writeFileSync(URL_LIST_FILE, result.join("\n").replace(/\n{3,}/g, "\n\n") + "\n", "utf8");
  console.log("Уникальных URL:", seen.size);
  console.log("Было строк с http:", text.match(/^https:\/\//gm)?.length || 0);
}

main();
