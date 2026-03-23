/**
 * Удаляет тёмный фон у foreign-изображений монет (если фон связан с краями кадра).
 * Безопасно: flood-fill от границы, поэтому тёмные элементы внутри монеты не трогаем.
 *
 * Запуск:
 *   node scripts/remove-dark-background-foreign.js --dry-run
 *   node scripts/remove-dark-background-foreign.js
 */
const fs = require("fs");
const path = require("path");
const sharp = require("sharp");

const ROOT = path.join(__dirname, "..");
const FOREIGN_DIR = path.join(ROOT, "public", "image", "coins", "foreign");
const REPORT_PATH = path.join(ROOT, "data", "foreign-dark-bg-report.tsv");

function parseArgs() {
  return {
    dryRun: process.argv.includes("--dry-run"),
    royalMintOnly: process.argv.includes("--royal-mint-only"),
  };
}

function isDarkBgPixel(r, g, b, a) {
  if (a < 200) return false;
  // "Тёмный фон": почти чёрный/тёмно-серый.
  return r <= 52 && g <= 52 && b <= 52;
}

function borderDarkRatio(data, w, h, ch) {
  const border = Math.max(2, Math.floor(Math.min(w, h) * 0.01));
  let dark = 0;
  let total = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const onBorder = x < border || y < border || x >= w - border || y >= h - border;
      if (!onBorder) continue;
      const i = (y * w + x) * ch;
      if (isDarkBgPixel(data[i], data[i + 1], data[i + 2], data[i + 3] ?? 255)) dark++;
      total++;
    }
  }
  return total ? dark / total : 0;
}

function removeDarkBorderConnectedBackground(data, w, h, ch) {
  const visited = new Uint8Array(w * h);
  const queue = [];
  const push = (x, y) => {
    if (x < 0 || y < 0 || x >= w || y >= h) return;
    const p = y * w + x;
    if (visited[p]) return;
    visited[p] = 1;
    queue.push(p);
  };

  for (let x = 0; x < w; x++) {
    push(x, 0);
    push(x, h - 1);
  }
  for (let y = 1; y < h - 1; y++) {
    push(0, y);
    push(w - 1, y);
  }

  let removed = 0;
  const neighbors = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ];

  while (queue.length) {
    const p = queue.pop();
    const x = p % w;
    const y = (p / w) | 0;
    const i = p * ch;
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    const aIdx = i + 3;
    const a = ch >= 4 ? data[aIdx] : 255;

    if (!isDarkBgPixel(r, g, b, a)) continue;

    if (ch >= 4) data[aIdx] = 0;
    else {
      // Если вдруг без alpha — не удаляем, чтобы не испортить.
      continue;
    }
    removed++;

    for (const [dx, dy] of neighbors) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      const np = ny * w + nx;
      if (!visited[np]) {
        visited[np] = 1;
        queue.push(np);
      }
    }
  }

  return removed;
}

async function processFile(fp, dryRun) {
  const input = await sharp(fp).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { data, info } = input;
  const w = info.width;
  const h = info.height;
  const ch = info.channels;
  const total = w * h;

  const ratio = borderDarkRatio(data, w, h, ch);
  if (ratio < 0.2) {
    return { changed: false, borderDarkRatio: ratio, removed: 0, removedRatio: 0 };
  }

  const out = Buffer.from(data);
  const removed = removeDarkBorderConnectedBackground(out, w, h, ch);
  const removedRatio = removed / total;
  if (removedRatio < 0.01) {
    return { changed: false, borderDarkRatio: ratio, removed, removedRatio };
  }

  if (!dryRun) {
    const encoded = await sharp(out, { raw: { width: w, height: h, channels: ch } })
      .webp({ quality: 90, effort: 6, smartSubsample: true })
      .toBuffer();
    fs.writeFileSync(fp, encoded);
  }

  return { changed: true, borderDarkRatio: ratio, removed, removedRatio };
}

async function main() {
  const { dryRun, royalMintOnly } = parseArgs();
  if (!fs.existsSync(FOREIGN_DIR)) {
    console.error("Папка не найдена:", FOREIGN_DIR);
    process.exit(1);
  }

  let files = fs
    .readdirSync(FOREIGN_DIR)
    .filter((f) => /\.webp$/i.test(f))
    .sort();

  if (royalMintOnly) {
    const dataDir = path.join(ROOT, "data");
    const rmJsonFiles = fs
      .readdirSync(dataDir)
      .filter((f) => /^royal-mint-.*\.json$/i.test(f))
      .map((f) => path.join(dataDir, f));
    const wanted = new Set();
    for (const jp of rmJsonFiles) {
      try {
        const raw = fs.readFileSync(jp, "utf8");
        const json = JSON.parse(raw);
        const imageContainer =
          json && typeof json === "object" && json.coin && typeof json.coin === "object" ? json.coin : json;
        for (const key of [
          "image_obverse",
          "image_reverse",
          "image_blister_obverse",
          "image_blister_reverse",
          "image_box",
          "image_certificate",
        ]) {
          const v = imageContainer ? imageContainer[key] : null;
          if (typeof v !== "string" || !v) continue;
          const m = v.match(/\/image\/coins\/foreign\/([^/?#]+\.webp)/i);
          if (m) wanted.add(m[1]);
        }
      } catch (_) {
        // Пропускаем битый JSON, чтобы не падать на единичных файлах.
      }
    }
    files = files.filter((f) => wanted.has(f));
  }

  let changed = 0;
  let skipped = 0;
  let errors = 0;
  const reportLines = ["file\tchanged\tborder_dark_ratio\tremoved_pixels\tremoved_ratio"];

  for (const f of files) {
    const fp = path.join(FOREIGN_DIR, f);
    try {
      const res = await processFile(fp, dryRun);
      if (res.changed) changed++;
      else skipped++;
      reportLines.push(
        [
          f,
          res.changed ? "1" : "0",
          res.borderDarkRatio.toFixed(4),
          String(res.removed),
          res.removedRatio.toFixed(4),
        ].join("\t")
      );
    } catch (e) {
      errors++;
      reportLines.push([f, "error", "0", "0", "0"].join("\t"));
      console.warn("Ошибка:", f, e.message);
    }
    const processed = changed + skipped + errors;
    if (processed % 100 === 0) {
      console.log("processed:", processed, "/", files.length, "changed:", changed);
    }
  }

  fs.writeFileSync(REPORT_PATH, reportLines.join("\n") + "\n", "utf8");
  console.log("Dry-run:", dryRun ? "yes" : "no");
  console.log("RoyalMintOnly:", royalMintOnly ? "yes" : "no");
  console.log("Files:", files.length, "changed:", changed, "skipped:", skipped, "errors:", errors);
  console.log("Report:", REPORT_PATH);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

