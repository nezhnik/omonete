/**
 * Аудит webp Royal Dutch: размеры, лишние кадры (img-**), несоответствие JSON/диску,
 * кандидаты на удаление «мелких» превью и список source_url для перепарсинга.
 *
 *   node scripts/audit-royaldutch-images.js
 *   node scripts/audit-royaldutch-images.js --min-side=480
 *   node scripts/audit-royaldutch-images.js --delete-low-quality   # удалить файлы с max(w,h) < min-side
 *   node scripts/audit-royaldutch-images.js --delete-legacy-img    # удалить *-img-NN.webp (старый пайплайн)
 *   node scripts/audit-royaldutch-images.js --delete-orphans       # файлы на диске для slug, которых нет в JSON (extra-*, мусор)
 *   node scripts/audit-royaldutch-images.js --write-refetch-list    # reports/royaldutch-refetch-urls.txt
 *
 * После удаления и при needsRefetch:
 *   npm run royaldutch:fetch:all
 *   npm run royaldutch:import && npm run data:sync-source-json-images && npm run data:export
 */
require("dotenv").config({ path: ".env" });
const fs = require("fs");
const path = require("path");
const sharp = require("sharp");
const { parseFlatBasename } = require("./lib/unified-foreign-image.js");
const { ROLE_SEQUENCE } = require("./fetch-royaldutch-product.js");

const ROOT = path.join(__dirname, "..");
const DATA_DIR = path.join(ROOT, "data");
const FOREIGN = path.join(ROOT, "public", "image", "coins", "foreign");
const REPORTS = path.join(ROOT, "reports");

function argvFlag(name) {
  return process.argv.includes(name);
}
function argvNum(name, defaultVal) {
  const a = process.argv.find((x) => x.startsWith(`${name}=`));
  if (!a) return defaultVal;
  const n = Number(a.split("=")[1]);
  return Number.isFinite(n) ? n : defaultVal;
}

const MIN_SIDE = argvNum("--min-side", 450);

function listRdmJsonFiles() {
  return fs
    .readdirSync(DATA_DIR)
    .filter((f) => f.startsWith("royaldutch-mint-") && f.endsWith(".json") && !f.includes("listing-products"))
    .map((f) => path.join(DATA_DIR, f))
    .sort();
}

function publicPathToAbs(u) {
  if (!u || typeof u !== "string") return null;
  const s = u.trim();
  if (!s.startsWith("/")) return null;
  return path.join(ROOT, "public", s.replace(/^\//, ""));
}

function basenameOnly(u) {
  if (!u) return null;
  const s = String(u).trim();
  const base = s.split("/").pop() || s;
  return base || null;
}

function expectedBasenamesFromCoin(c) {
  const set = new Set();
  for (const k of ["image_obverse", "image_reverse", "image_packaging", "image_box", "image_certificate"]) {
    const b = basenameOnly(c[k]);
    if (b) set.add(b);
  }
  const arr = c.imageUrls;
  if (Array.isArray(arr)) {
    for (const u of arr) {
      const b = basenameOnly(u);
      if (b) set.add(b);
    }
  }
  return set;
}

function diskFilesForSlug(slug) {
  if (!fs.existsSync(FOREIGN)) return [];
  const prefix = `${slug}-`;
  return fs
    .readdirSync(FOREIGN)
    .filter((f) => f.startsWith(prefix) && /\.webp$/i.test(f))
    .sort();
}

function isLegacyImgRole(role) {
  return /^img-\d+$/i.test(String(role || ""));
}

async function metaForFile(absPath) {
  try {
    const m = await sharp(absPath).metadata();
    const w = m.width || 0;
    const h = m.height || 0;
    const maxSide = Math.max(w, h);
    const st = fs.statSync(absPath);
    return { width: w, height: h, maxSide, bytes: st.size };
  } catch {
    return { width: 0, height: 0, maxSide: 0, bytes: 0, error: true };
  }
}

async function main() {
  const deleteLow = argvFlag("--delete-low-quality");
  const deleteLegacy = argvFlag("--delete-legacy-img");
  const deleteOrphans = argvFlag("--delete-orphans");
  const writeRefetch = argvFlag("--write-refetch-list");

  const files = listRdmJsonFiles();
  const perCoin = [];
  let deletedCount = 0;

  for (const fp of files) {
    let raw;
    try {
      raw = JSON.parse(fs.readFileSync(fp, "utf8"));
    } catch {
      continue;
    }
    const c = raw.coin || {};
    const slug = String(c.slug || "").trim();
    const sourceUrl = String(c.source_url || "").trim();
    if (!slug) continue;

    const expectedNames = expectedBasenamesFromCoin(c);
    const onDisk = diskFilesForSlug(slug);

    const fileReports = [];
    const toDelete = new Map();

    let lowQualityAmongExpected = false;

    for (const fn of onDisk) {
      const stem = fn.replace(/\.webp$/i, "");
      const { role } = parseFlatBasename(stem);
      const abs = path.join(FOREIGN, fn);
      const meta = await metaForFile(abs);
      const lowQuality = meta.maxSide > 0 && meta.maxSide < MIN_SIDE;
      const legacySlot = isLegacyImgRole(role);

      const expected = expectedNames.has(fn);
      if (expected && lowQuality) lowQualityAmongExpected = true;

      if (deleteLegacy && legacySlot) toDelete.set(abs, "legacy-img-slot");
      if (deleteLow && lowQuality) toDelete.set(abs, `low-quality maxSide=${meta.maxSide}`);
      if (deleteOrphans && !expected) toDelete.set(abs, "orphan-not-in-json");

      fileReports.push({
        file: fn,
        role,
        ...meta,
        lowQuality,
        legacyImgSlot: legacySlot,
        inJson: expected,
      });
    }

    for (const abs of toDelete.keys()) {
      try {
        fs.unlinkSync(abs);
        deletedCount++;
      } catch (_) {}
    }

    const stillOnDisk = new Set(diskFilesForSlug(slug));
    const missingOnDisk = [...expectedNames].filter((n) => !stillOnDisk.has(n));

    perCoin.push({
      slug,
      sourceUrl,
      jsonPath: path.basename(fp),
      title: String(c.title || "").slice(0, 80),
      expectedRolesOrdered: [...ROLE_SEQUENCE],
      files: fileReports,
      missingOnDisk,
      orphansOnDiskAfterAudit: [...diskFilesForSlug(slug)].filter((n) => !expectedNames.has(n)),
      needsRefetch: !!sourceUrl && (missingOnDisk.length > 0 || lowQualityAmongExpected),
    });
  }

  const summary = {
    generatedAt: new Date().toISOString(),
    minSideMaxDimension: MIN_SIDE,
    coins: perCoin.length,
    needRefetchCount: perCoin.filter((x) => x.needsRefetch).length,
    deletedFiles: deletedCount,
    flags: { deleteLow, deleteLegacy, deleteOrphans, writeRefetch },
  };

  if (!fs.existsSync(REPORTS)) fs.mkdirSync(REPORTS, { recursive: true });
  const jsonPath = path.join(REPORTS, "royaldutch-image-audit.json");
  fs.writeFileSync(jsonPath, JSON.stringify({ summary, perCoin }, null, 2), "utf8");

  const lines = [
    `# Royal Dutch — аудит картинок`,
    ``,
    `- Монет (JSON): ${summary.coins}`,
    `- Порог «хорошего» размера: max(width,height) ≥ **${MIN_SIDE}** px`,
    `- Нужен перепарс (нет файла из JSON или мелкий ожидаемый кадр): **${summary.needRefetchCount}**`,
    `- Удалено файлов этим запуском: **${deletedCount}**`,
    ``,
    `## Кому нужен refetch (первые 40)`,
    ...perCoin
      .filter((x) => x.needsRefetch)
      .slice(0, 40)
      .map((x) => `- ${x.slug} — missing: ${x.missingOnDisk.join(", ") || "—"} ; low among expected: see json`),
    perCoin.filter((x) => x.needsRefetch).length > 40 ? `\n… и ещё ${perCoin.filter((x) => x.needsRefetch).length - 40}` : "",
    ``,
    `Полный отчёт: \`reports/royaldutch-image-audit.json\``,
  ];
  fs.writeFileSync(path.join(REPORTS, "royaldutch-image-audit.md"), lines.filter(Boolean).join("\n"), "utf8");

  if (writeRefetch) {
    const urls = perCoin.filter((x) => x.needsRefetch && x.sourceUrl).map((x) => x.sourceUrl);
    fs.writeFileSync(path.join(REPORTS, "royaldutch-refetch-urls.txt"), urls.join("\n") + (urls.length ? "\n" : ""), "utf8");
  }

  console.log(JSON.stringify(summary, null, 2));
  console.log("JSON:", jsonPath);
  console.log("MD:  ", path.join(REPORTS, "royaldutch-image-audit.md"));
  if (writeRefetch) console.log("URLs:", path.join(REPORTS, "royaldutch-refetch-urls.txt"));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
