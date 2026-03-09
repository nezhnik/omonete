const fs = require("fs");
const path = require("path");

const DATA_DIR = path.join(__dirname, "..", "data");
const LOG_FILE = path.join(__dirname, "fix-perth-series-log-final.txt");

function loadPerthFiles() {
  const entries = fs.readdirSync(DATA_DIR).filter((f) => f.startsWith("perth-mint-") && f.endsWith(".json"));
  return entries.map((f) => {
    const slug = f.replace(/^perth-mint-/, "").replace(/\.json$/, "");
    return { file: f, slug };
  });
}

function parseLogLines() {
  if (!fs.existsSync(LOG_FILE)) {
    console.error("Лог не найден:", LOG_FILE);
    process.exit(1);
  }
  const text = fs.readFileSync(LOG_FILE, "utf8");
  const lines = text.split(/\r?\n/);
  const re = /^\s*✓\s+([^:]+):\s+"(.*)"\s+→\s+"(.*)"\s*$/;
  const items = [];
  for (const line of lines) {
    const m = line.match(re);
    if (!m) continue;
    const frag = m[1].trim();
    const prev = m[2];
    const next = m[3];
    if (next === prev) continue;
    items.push({ frag, prev, next });
  }
  return items;
}

function findFileByFragment(files, frag) {
  const candidates = files.filter((f) => f.slug.startsWith(frag));
  if (candidates.length === 0) return null;
  const exact = candidates.find((f) => f.slug === frag);
  if (exact) return exact;
  if (candidates.length === 1) return candidates[0];
  console.warn(`Несколько файлов для фрагмента "${frag}", пропускаю:`, candidates.map((c) => c.file).join(", "));
  return null;
}

function main() {
  const files = loadPerthFiles();
  const lines = parseLogLines();

  let updated = 0;
  let skippedNoFile = 0;

  for (const { frag, next } of lines) {
    const target = findFileByFragment(files, frag);
    if (!target) {
      skippedNoFile++;
      continue;
    }
    const jsonPath = path.join(DATA_DIR, target.file);
    let raw;
    try {
      raw = JSON.parse(fs.readFileSync(jsonPath, "utf8"));
    } catch {
      console.warn("Не удалось прочитать JSON:", jsonPath);
      continue;
    }
    if (!raw.coin) continue;
    const finalSeries = next === "null" ? null : next;
    if (raw.coin.series === finalSeries) continue;
    raw.coin.series = finalSeries;
    fs.writeFileSync(jsonPath, JSON.stringify(raw, null, 2), "utf8");
    updated++;
  }

  console.log(`Готово. Обновлено файлов: ${updated}, без файла по фрагменту: ${skippedNoFile}`);
}

main();

