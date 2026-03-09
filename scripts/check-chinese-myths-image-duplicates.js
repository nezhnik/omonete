/**
 * Проверка дубликатов картинок в серии Chinese Myths and Legends.
 *
 * Ищем случаи, когда в одном каноническом JSON:
 *  - image_obverse, image_reverse, image_box, image_certificate
 *  указывают на ОДИН и тот же путь, т.е. реальный дубль файла.
 *
 * Запуск:
 *   node scripts/check-chinese-myths-image-duplicates.js
 */

const fs = require("fs");
const path = require("path");

const DATA_DIR = path.join(__dirname, "..", "data");

function main() {
  const files = fs
    .readdirSync(DATA_DIR)
    .filter(
      (f) =>
        f.startsWith("perth-mint-chinese-myths") &&
        f.endsWith(".json")
    );

  const problems = [];

  for (const f of files) {
    const full = path.join(DATA_DIR, f);
    let raw;
    try {
      raw = JSON.parse(fs.readFileSync(full, "utf8"));
    } catch {
      continue;
    }
    const c = raw.coin || {};
    const images = {
      obverse: c.image_obverse || null,
      reverse: c.image_reverse || null,
      box: c.image_box || null,
      certificate: c.image_certificate || null,
    };

    const entries = Object.entries(images).filter(([, v]) => !!v);
    if (entries.length < 2) continue;

    // Проверяем, есть ли дубликаты путей между разными ролями.
    for (let i = 0; i < entries.length; i++) {
      for (let j = i + 1; j < entries.length; j++) {
        const [roleA, pathA] = entries[i];
        const [roleB, pathB] = entries[j];
        if (pathA === pathB) {
          problems.push({
            file: f,
            roles: [roleA, roleB],
            path: pathA,
          });
        }
      }
    }
  }

  if (!problems.length) {
    console.log("Дубликатов путей в image_* для Chinese Myths and Legends не найдено.");
    return;
  }

  console.log("Найдены дубликаты путей в image_* (Chinese Myths and Legends):");
  for (const p of problems) {
    console.log(
      `  ${p.file}: ${p.roles.join(" = ")} → ${p.path}`
    );
  }
}

main();

