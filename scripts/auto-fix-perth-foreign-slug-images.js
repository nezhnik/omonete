/**
 * Авто‑фиксер для проблемных картинок Perth из foreign-slug списка.
 *
 * Цели:
 *  - НЕ трогаем хорошие монеты.
 *  - Меняем только те записи, которые уже помечены как foreignSlug
 *    в data/perth-image-foreign-slug-links.txt.
 *  - Для каждой такой записи пытаемся найти "свой" файл на диске:
 *      <slug>-obv.webp / <slug>-rev.webp / <slug>-box.webp / <slug>-cert.webp
 *    и подставляем его вместо чужого пути.
 *
 * Защиты:
 *  - если для slug нет подходящего файла на диске — пропускаем;
 *  - если в JSON путь уже содержит slug монеты — не трогаем (значит, уже починили);
 *  - если целевой файл на диске отсутствует — не трогаем;
 *  - если путь уже совпадает с тем, что хотим поставить — не трогаем.
 *
 * Запуск:
 *   node scripts/auto-fix-perth-foreign-slug-images.js
 */

const fs = require("fs");
const path = require("path");

const ROOT_DIR = path.join(__dirname, "..");
const DATA_DIR = path.join(ROOT_DIR, "data");
const PUBLIC_DIR = path.join(ROOT_DIR, "public");
const FOREIGN_DIR = path.join(PUBLIC_DIR, "image", "coins", "foreign");

const FOREIGN_SLUG_FILE = path.join(DATA_DIR, "perth-image-foreign-slug-links.txt");

function parseForeignSlugLines() {
  if (!fs.existsSync(FOREIGN_SLUG_FILE)) {
    throw new Error(`Не найден файл ${FOREIGN_SLUG_FILE}`);
  }
  const raw = fs.readFileSync(FOREIGN_SLUG_FILE, "utf8");
  const lines = raw
    .split(/\r?\n/g)
    .map((s) => s.trim())
    .filter(Boolean);

  return lines.map((line, idx) => {
    const parts = line.split(" | ");
    const obj = { index: idx + 1 };
    for (const part of parts) {
      const [k, v] = part.split("=");
      if (!k) continue;
      obj[k] = v;
    }
    // Нормализуем некоторые поля
    if (obj.id === "(id не найден)") {
      obj.id = null;
    }
    return obj;
  });
}

function scanForeignFiles() {
  const result = Object.create(null);

  if (!fs.existsSync(FOREIGN_DIR)) {
    console.warn(`Директория с картинками не найдена: ${FOREIGN_DIR}`);
    return result;
  }

  const files = fs.readdirSync(FOREIGN_DIR).filter((f) => f.toLowerCase().endsWith(".webp"));

  for (const f of files) {
    const base = f.replace(/\.webp$/i, "");
    const lower = base.toLowerCase();

    let role = null;
    let slug = base;

    if (lower.endsWith("-obv")) {
      role = "obv";
      slug = base.slice(0, -4);
    } else if (lower.endsWith("-rev")) {
      role = "rev";
      slug = base.slice(0, -4);
    } else if (lower.endsWith("-box")) {
      role = "box";
      slug = base.slice(0, -4);
    } else if (lower.endsWith("-cert")) {
      role = "cert";
      slug = base.slice(0, -5);
    }

    if (!result[slug]) {
      result[slug] = { obv: null, rev: null, box: null, cert: null, extra: [] };
    }

    if (role && !result[slug][role]) {
      result[slug][role] = f;
    } else {
      result[slug].extra.push(f);
    }
  }

  return result;
}

function main() {
  const entries = parseForeignSlugLines();
  const imagesBySlug = scanForeignFiles();

  const keyByRole = {
    obv: "image_obverse",
    rev: "image_reverse",
    box: "image_box",
    cert: "image_certificate",
  };

  const savedKeyByRole = {
    obv: "obverse",
    rev: "reverse",
    box: "box",
    cert: "certificate",
  };

  let updated = 0;
  let skippedNoSlugImages = 0;
  let skippedNoRoleFile = 0;
  let skippedAlreadyContainsSlug = 0;
  let skippedMissingFs = 0;
  let skippedSamePath = 0;

  for (const e of entries) {
    const file = e.file;
    const role = e.role;
    const slug = e.slug;
    const currentPath = e.path;

    if (!file || !role || !slug || !currentPath) continue;

    const jsonPath = path.join(DATA_DIR, file);
    if (!fs.existsSync(jsonPath)) continue;

    const imgInfo = imagesBySlug[slug];
    if (!imgInfo) {
      skippedNoSlugImages++;
      continue;
    }

    const roleFile = imgInfo[role];
    if (!roleFile) {
      skippedNoRoleFile++;
      continue;
    }

    const absImg = path.join(FOREIGN_DIR, roleFile);
    if (!fs.existsSync(absImg)) {
      skippedMissingFs++;
      continue;
    }

    const raw = JSON.parse(fs.readFileSync(jsonPath, "utf8"));
    const coin = raw.coin || {};

    const coinKey = keyByRole[role];
    if (!coinKey) continue;

    const currentCoinPath = coin[coinKey];

    // Если в самом JSON путь уже содержит slug монеты – не трогаем.
    if (typeof currentCoinPath === "string" && currentCoinPath.includes(slug)) {
      skippedAlreadyContainsSlug++;
      continue;
    }

    const newRel = `/image/coins/foreign/${roleFile}`;
    if (currentCoinPath === newRel) {
      skippedSamePath++;
      continue;
    }

    coin[coinKey] = newRel;
    raw.coin = coin;

    // Попробуем аккуратно синхронизировать raw.saved, если есть.
    if (raw.saved && typeof raw.saved === "object") {
      const savedKey = savedKeyByRole[role];
      if (savedKey) {
        raw.saved[savedKey] = newRel;
      }
    }

    fs.writeFileSync(jsonPath, JSON.stringify(raw, null, 2), "utf8");
    updated++;
  }

  console.log("Готово. Автоматически обновили путей:", updated);
  console.log("Пропущено (нет картинок для slug):", skippedNoSlugImages);
  console.log("Пропущено (нет файла для роли):", skippedNoRoleFile);
  console.log("Пропущено (в JSON уже есть свой slug):", skippedAlreadyContainsSlug);
  console.log("Пропущено (файл на диске не найден):", skippedMissingFs);
  console.log("Пропущено (путь уже такой же):", skippedSamePath);
}

main();

