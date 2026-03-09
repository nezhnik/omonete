/**
 * Обнуляет заведомо неправильные пути картинок Perth из списка foreign-slug.
 *
 * Идея:
 *  - Используем data/perth-image-foreign-slug-links.txt, где уже собраны
 *    только "подозрительные" картинки (путь не содержит slug монеты).
 *  - Для КАЖДОЙ такой записи выставляем соответствующий coin.image_*
 *    в null, чтобы убрать неверную картинку.
 *
 * Безопасность:
 *  - Никакие другие монеты/картинки не трогаем.
 *  - Внутри файла, если уже вдруг стоит путь со своим slug, не трогаем
 *    (например, вы уже руками поправили JSON, но .txt ещё старый).
 *  - По возможности синхронизируем raw.saved.* (если есть такой ключ).
 *
 * Запуск:
 *   node scripts/null-perth-foreign-slug-images.js
 */

const fs = require("fs");
const path = require("path");

const ROOT_DIR = path.join(__dirname, "..");
const DATA_DIR = path.join(ROOT_DIR, "data");
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
    if (obj.id === "(id не найден)") obj.id = null;
    return obj;
  });
}

function main() {
  const entries = parseForeignSlugLines();

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
  let skippedAlreadyOk = 0;
  let skippedNoKey = 0;

  for (const e of entries) {
    const file = e.file;
    const role = e.role;
    const slug = e.slug;
    if (!file || !role || !slug) continue;

    const jsonPath = path.join(DATA_DIR, file);
    if (!fs.existsSync(jsonPath)) continue;

    const raw = JSON.parse(fs.readFileSync(jsonPath, "utf8"));
    const coin = raw.coin || {};
    const coinKey = keyByRole[role];
    if (!coinKey) {
      skippedNoKey++;
      continue;
    }

    const current = coin[coinKey];
    // Если уже стоит null/undefined — нечего чистить.
    if (current == null) {
      skippedAlreadyOk++;
      continue;
    }
    // Если вдруг путь уже содержит свой slug — считаем, что вы уже поправили,
    // а .txt ещё старый. Не трогаем.
    if (typeof current === "string" && current.includes(slug)) {
      skippedAlreadyOk++;
      continue;
    }

    coin[coinKey] = null;
    raw.coin = coin;

    if (raw.saved && typeof raw.saved === "object") {
      const savedKey = savedKeyByRole[role];
      if (savedKey) {
        raw.saved[savedKey] = null;
      }
    }

    fs.writeFileSync(jsonPath, JSON.stringify(raw, null, 2), "utf8");
    updated++;
  }

  console.log("Готово. Обнулили проблемных путей:", updated);
  console.log("Пропущено (уже ок / null / свой slug):", skippedAlreadyOk);
  console.log("Пропущено (нет ключа для роли):", skippedNoKey);
}

main();

