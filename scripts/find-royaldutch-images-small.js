/**
 * Список webp Royal Dutch с размером меньше заданного порога (по умолчанию 140×140).
 *
 *   node scripts/find-royaldutch-images-small.js
 *   node scripts/find-royaldutch-images-small.js --max=140
 *   node scripts/find-royaldutch-images-small.js --mode=max   # max(w,h) < max
 *
 * Режимы:
 *   both (по умолчанию): width < max && height < max
 *   max: max(width,height) < max
 */
const fs = require("fs");
const path = require("path");
const sharp = require("sharp");

const ROOT = path.join(__dirname, "..");
const DATA_DIR = path.join(ROOT, "data");
const FOREIGN = path.join(ROOT, "public", "image", "coins", "foreign");
const REPORTS = path.join(ROOT, "reports");

function argvNum(name, d) {
  const a = process.argv.find((x) => x.startsWith(`${name}=`));
  if (!a) return d;
  const n = Number(a.split("=")[1]);
  return Number.isFinite(n) ? n : d;
}

function argvMode() {
  const a = process.argv.find((x) => x.startsWith("--mode="));
  const m = a ? a.slice("--mode=".length).trim() : "both";
  return m === "max" ? "max" : "both";
}

function listRdmJsonFiles() {
  return fs
    .readdirSync(DATA_DIR)
    .filter((f) => f.startsWith("royaldutch-mint-") && f.endsWith(".json") && !f.includes("listing-products"))
    .map((f) => path.join(DATA_DIR, f))
    .sort();
}

function diskWebpForSlug(slug) {
  if (!fs.existsSync(FOREIGN)) return [];
  const prefix = `${slug}-`;
  return fs.readdirSync(FOREIGN).filter((f) => f.startsWith(prefix) && /\.webp$/i.test(f));
}

function isSmall(w, h, maxPx, mode) {
  if (mode === "max") return Math.max(w, h) < maxPx;
  return w < maxPx && h < maxPx;
}

async function main() {
  const maxPx = argvNum("--max", 140);
  const mode = argvMode();

  const hits = [];
  let filesChecked = 0;

  for (const fp of listRdmJsonFiles()) {
    let c;
    try {
      c = JSON.parse(fs.readFileSync(fp, "utf8")).coin || {};
    } catch {
      continue;
    }
    const slug = String(c.slug || "").trim();
    if (!slug) continue;

    for (const fn of diskWebpForSlug(slug)) {
      filesChecked++;
      const abs = path.join(FOREIGN, fn);
      let m;
      try {
        m = await sharp(abs).metadata();
      } catch {
        hits.push({ slug, file: fn, width: 0, height: 0, error: true });
        continue;
      }
      const w = m.width || 0;
      const h = m.height || 0;
      if (isSmall(w, h, maxPx, mode)) {
        let st;
        try {
          st = fs.statSync(abs);
        } catch {
          st = { size: 0 };
        }
        hits.push({
          slug,
          file: fn,
          width: w,
          height: h,
          maxSide: Math.max(w, h),
          bytes: st.size,
        });
      }
    }
  }

  const report = {
    generatedAt: new Date().toISOString(),
    threshold: maxPx,
    mode,
    modeHint:
      mode === "both"
        ? `width < ${maxPx} && height < ${maxPx}`
        : `max(width,height) < ${maxPx}`,
    royalDutchWebpFilesChecked: filesChecked,
    smallImagesCount: hits.length,
    items: hits.sort((a, b) => a.slug.localeCompare(b.slug) || a.file.localeCompare(b.file)),
  };

  if (!fs.existsSync(REPORTS)) fs.mkdirSync(REPORTS, { recursive: true });
  const out = path.join(REPORTS, "royaldutch-images-below-max.json");
  fs.writeFileSync(out, JSON.stringify(report, null, 2) + "\n", "utf8");

  console.log(
    JSON.stringify(
      {
        threshold: report.threshold,
        mode: report.mode,
        checked: report.royalDutchWebpFilesChecked,
        smallCount: report.smallImagesCount,
        report: out,
      },
      null,
      2
    )
  );
  console.log("Полный список:", out);

  // печать краткой таблицы
  for (const x of hits.slice(0, 50)) {
    console.log(`${x.slug}\t${x.width}x${x.height}\t${x.file}`);
  }
  if (hits.length > 50) console.log(`… ещё ${hits.length - 50} строк в JSON`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
