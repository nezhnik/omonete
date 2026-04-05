/**
 * Старый формат: public/image/coins/foreign/royaldutch/<slug>/01.png, 02.jpg, …
 * Целевой:    public/image/coins/foreign/<slug>-obv.webp … (как в экспорте / fetch).
 *
 *   node scripts/migrate-royaldutch-nested-to-flat-webp.js
 *   node scripts/migrate-royaldutch-nested-to-flat-webp.js --dry-run
 *   node scripts/migrate-royaldutch-nested-to-flat-webp.js --force   # перезаписать flat webp даже если obv уже есть
 */
const fs = require("fs");
const path = require("path");
const sharp = require("sharp");
const { roleFromIndex } = require("./lib/save-foreign-unified-webp.js");
const { unifiedForeignUrl } = require("./lib/unified-foreign-image.js");

const ROOT = path.join(__dirname, "..");
const FOREIGN = path.join(ROOT, "public", "image", "coins", "foreign");
const NESTED = path.join(FOREIGN, "royaldutch");
const MAX_SIDE = 1200;
const WEBP_OPTS = { quality: 82, effort: 6, smartSubsample: true };

function argvDry() {
  return process.argv.includes("--dry-run");
}
function argvForce() {
  return process.argv.includes("--force");
}

function sortedNumberedFiles(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => /^\d+\.(png|jpe?g|webp)$/i.test(f))
    .sort((a, b) => {
      const na = parseInt(a.replace(/^(\d+).*/, "$1"), 10);
      const nb = parseInt(b.replace(/^(\d+).*/, "$1"), 10);
      return na - nb;
    });
}

async function fileToUnifiedWebp(srcAbs, slug, oneBasedIndex) {
  const role = roleFromIndex(oneBasedIndex);
  const url = unifiedForeignUrl(slug, role);
  const outAbs = path.join(ROOT, "public", url.replace(/^\//, ""));
  const buf = await fs.promises.readFile(srcAbs);
  const out = await sharp(buf)
    .resize(MAX_SIDE, MAX_SIDE, { fit: "inside", withoutEnlargement: true })
    .webp(WEBP_OPTS)
    .toBuffer();
  await fs.promises.mkdir(path.dirname(outAbs), { recursive: true });
  await fs.promises.writeFile(outAbs, out);
  return { url, outAbs };
}

async function main() {
  const dry = argvDry();
  const force = argvForce();
  if (!fs.existsSync(NESTED)) {
    console.log("Нет папки", NESTED);
    return;
  }
  const dirs = fs.readdirSync(NESTED).filter((d) => {
    const p = path.join(NESTED, d);
    return fs.statSync(p).isDirectory();
  });
  let converted = 0;
  let skippedDir = 0;
  const report = [];

  for (const slug of dirs.sort()) {
    const dir = path.join(NESTED, slug);
    const files = sortedNumberedFiles(dir);
    if (!files.length) continue;

    const obvPath = path.join(FOREIGN, `${slug}-obv.webp`);
    if (!force && fs.existsSync(obvPath)) {
      skippedDir++;
      continue;
    }

    for (const f of files) {
      const abs = path.join(dir, f);
      const m = f.match(/^(\d+)\./);
      if (!m) continue;
      const idx = parseInt(m[1], 10);
      if (!Number.isFinite(idx) || idx < 1) continue;
      try {
        if (!dry) {
          await fileToUnifiedWebp(abs, slug, idx);
        }
        converted++;
        report.push(`${slug} ${f} → ${roleFromIndex(idx)}`);
      } catch (e) {
        report.push(`ERR ${slug} ${f}: ${e.message}`);
      }
    }
  }

  console.log(
    JSON.stringify(
      {
        dryRun: dry,
        force,
        nestedDirs: dirs.length,
        skippedDirsAlreadyHaveFlatObv: skippedDir,
        framesConverted: converted,
        sample: report.slice(0, 30),
      },
      null,
      2
    )
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
