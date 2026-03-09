/**
 * Формирует в out/regre/ только изменённые и новые файлы из out/
 * для инкрементальной загрузки на Reg.ru.
 * Сравнение с предыдущим состоянием — по манифесту deploy-manifest.json.
 */

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const OUT_DIR = path.join(ROOT, "out");
const REGRE_DIR = path.join(OUT_DIR, "regre");
const MANIFEST_PATH = path.join(ROOT, "deploy-manifest.json");

// папки/файлы в out, которые не учитываем
const SKIP = new Set(["regre", ".git", "deploy-manifest.json"]);

function walkDir(dir, base = "", acc = {}) {
  if (!fs.existsSync(dir)) return acc;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const e of entries) {
    const rel = base ? `${base}/${e.name}` : e.name;
    if (SKIP.has(e.name)) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      walkDir(full, rel, acc);
    } else {
      const stat = fs.statSync(full);
      // сигнатура без чтения содержимого (быстро для больших out)
      acc[rel] = `${stat.mtimeMs}-${stat.size}`;
    }
  }
  return acc;
}

function loadManifest() {
  try {
    const data = fs.readFileSync(MANIFEST_PATH, "utf8");
    return JSON.parse(data);
  } catch {
    return {};
  }
}

function saveManifest(obj) {
  fs.writeFileSync(MANIFEST_PATH, JSON.stringify(obj, null, 2), "utf8");
}

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function clearDir(dir) {
  if (!fs.existsSync(dir)) return;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      fs.rmSync(full, { recursive: true });
    } else {
      fs.unlinkSync(full);
    }
  }
}

function main() {
  if (!fs.existsSync(OUT_DIR)) {
    console.error("Папка out/ не найдена. Сначала выполните npm run build.");
    process.exit(1);
  }

  const prev = loadManifest();
  const current = walkDir(OUT_DIR);

  const toUpload = [];
  const deleted = [];

  for (const [rel, sig] of Object.entries(current)) {
    if (prev[rel] !== sig) toUpload.push(rel);
  }
  for (const rel of Object.keys(prev)) {
    if (!(rel in current)) deleted.push(rel);
  }

  clearDir(REGRE_DIR);
  ensureDir(REGRE_DIR);

  for (const rel of toUpload) {
    const src = path.join(OUT_DIR, rel);
    const dest = path.join(REGRE_DIR, rel);
    ensureDir(path.dirname(dest));
    fs.copyFileSync(src, dest);
  }

  if (deleted.length) {
    fs.writeFileSync(
      path.join(REGRE_DIR, "deleted.txt"),
      deleted.join("\n"),
      "utf8"
    );
  }

  saveManifest(current);

  console.log(
    `regre: загрузить ${toUpload.length} файлов${deleted.length ? `, удалить на сервере ${deleted.length} (см. out/regre/deleted.txt)` : ""}.`
  );
}

main();
