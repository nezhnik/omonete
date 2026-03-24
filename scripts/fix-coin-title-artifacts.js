/**
 * Разовая/повторная чистка title в уже выгруженных JSON (без БД).
 * Синхронизировано с cleanTitle в export-coins-to-json.js.
 */
const fs = require("fs");
const path = require("path");

function cleanTitle(s) {
  if (s == null || typeof s !== "string") return "";
  let t = s
    .replace(/<nobr>/gi, "")
    .replace(/<\/nobr>/gi, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/\bWe value your privacy\b/gi, "")
    .replace(/\s+(?:Obverse|Awers):\s*.+$/i, "")
    .replace(/\s+/g, " ")
    .trim();
  return t;
}

const dataDir = path.join(__dirname, "..", "public", "data");
const listPath = path.join(dataDir, "coins.json");
const coinsDir = path.join(dataDir, "coins");

function main() {
  if (!fs.existsSync(listPath)) {
    console.error("Нет файла:", listPath);
    process.exit(1);
  }
  const list = JSON.parse(fs.readFileSync(listPath, "utf8"));
  let listChanged = 0;
  list.coins = list.coins.map((c) => {
    const t = cleanTitle(c.title);
    if (t !== c.title) listChanged++;
    return { ...c, title: t };
  });
  fs.writeFileSync(listPath, JSON.stringify(list));
  console.log("coins.json: исправлено названий:", listChanged);

  let detailChanged = 0;
  if (fs.existsSync(coinsDir)) {
    for (const f of fs.readdirSync(coinsDir)) {
      if (!f.endsWith(".json")) continue;
      const p = path.join(coinsDir, f);
      let raw;
      try {
        raw = JSON.parse(fs.readFileSync(p, "utf8"));
      } catch {
        continue;
      }
      if (!raw.coin || typeof raw.coin.title !== "string") continue;
      const t = cleanTitle(raw.coin.title);
      if (t === raw.coin.title) continue;
      raw.coin.title = t;
      fs.writeFileSync(p, JSON.stringify(raw));
      detailChanged++;
      console.log(" ", f, "→", t.slice(0, 72) + (t.length > 72 ? "…" : ""));
    }
  }
  console.log("coins/*.json: исправлено файлов:", detailChanged);
}

main();
