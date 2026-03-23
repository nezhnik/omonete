/**
 * Чистка лишних картинок Royal Mint:
 * 1) capsule-* полностью убираем (в JSON и на диске);
 * 2) edge-* удаляем из mirror index, если для того же slug+role есть не-edge URL.
 *
 * По умолчанию меняет файлы. Для проверки:
 *   node scripts/royal-mint-cleanup-extra-images.js --dry-run
 */
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const DATA_DIR = path.join(ROOT, "data");
const FOREIGN_DIR = path.join(ROOT, "public", "image", "coins", "foreign");
const MIRROR_INDEX = path.join(DATA_DIR, "royal-mint-image-mirror-index.json");

function parseArgs() {
  return { dryRun: process.argv.includes("--dry-run") };
}

function readJson(abs) {
  return JSON.parse(fs.readFileSync(abs, "utf8"));
}

function isCapsuleUrl(u) {
  return /capsule/i.test(String(u || ""));
}

function isEdgeUrl(u) {
  return /(^|[^a-z])edge([^a-z]|$)/i.test(String(u || ""));
}

function unlinkSafe(abs, dryRun) {
  if (!abs || !fs.existsSync(abs)) return false;
  if (dryRun) return true;
  fs.unlinkSync(abs);
  return true;
}

function cleanupRoyalMintJsons(dryRun) {
  const jsonFiles = fs
    .readdirSync(DATA_DIR)
    .filter((f) => /^royal-mint-.*\.json$/i.test(f) && !/royal-mint-image-(audit|manifest|mirror-index)/i.test(f));

  let jsonTouched = 0;
  let filesDeleted = 0;

  for (const file of jsonFiles) {
    const abs = path.join(DATA_DIR, file);
    let j;
    try {
      j = readJson(abs);
    } catch {
      continue;
    }
    const coin = j && j.coin && typeof j.coin === "object" ? j.coin : null;
    const raw = j && j.raw && typeof j.raw === "object" ? j.raw : null;
    const saved = j && j.saved && typeof j.saved === "object" ? j.saved : null;
    if (!coin || !raw) continue;

    let touched = false;
    for (const pair of [
      ["blister_obverse", "image_blister_obverse"],
      ["blister_reverse", "image_blister_reverse"],
    ]) {
      const role = pair[0];
      const coinKey = pair[1];
      const classifiedUrl = raw.classified && raw.classified[role];
      if (!isCapsuleUrl(classifiedUrl)) continue;

      const rel = coin[coinKey] || (saved ? saved[role] : null);
      if (typeof rel === "string" && rel.includes("/image/coins/foreign/")) {
        const basename = path.basename(rel);
        const absImg = path.join(FOREIGN_DIR, basename);
        if (unlinkSafe(absImg, dryRun)) filesDeleted++;
      }

      coin[coinKey] = null;
      if (saved) saved[role] = null;
      if (raw.classified) raw.classified[role] = null;
      touched = true;
    }

    if (touched) {
      jsonTouched++;
      if (!dryRun) fs.writeFileSync(abs, JSON.stringify(j, null, 2) + "\n", "utf8");
    }
  }

  return { jsonTouched, filesDeleted };
}

function cleanupMirrorIndex(dryRun) {
  if (!fs.existsSync(MIRROR_INDEX)) return { indexTouched: 0, mirrorFilesDeleted: 0, removedUrls: 0 };
  const idx = readJson(MIRROR_INDEX);
  const byUrl = idx && idx.by_url && typeof idx.by_url === "object" ? idx.by_url : {};
  const entries = Object.entries(byUrl);

  const group = new Map(); // slug|role => [{url, path}]
  for (const [url, meta] of entries) {
    const slug = String(meta && meta.slug ? meta.slug : "");
    const role = String(meta && meta.role ? meta.role : "");
    if (!slug || !role) continue;
    const k = `${slug}|${role}`;
    if (!group.has(k)) group.set(k, []);
    group.get(k).push({ url, meta });
  }

  const removeUrls = new Set();
  for (const [url] of entries) {
    if (isCapsuleUrl(url)) removeUrls.add(url);
  }

  for (const [, arr] of group.entries()) {
    const hasNonEdge = arr.some((x) => !isEdgeUrl(x.url));
    if (!hasNonEdge) continue;
    for (const x of arr) {
      if (isEdgeUrl(x.url)) removeUrls.add(x.url);
    }
  }

  if (!removeUrls.size) return { indexTouched: 0, mirrorFilesDeleted: 0, removedUrls: 0 };

  const pathUsage = new Map();
  for (const [url, meta] of entries) {
    if (removeUrls.has(url)) continue;
    const p = meta && meta.path;
    if (!p) continue;
    pathUsage.set(p, (pathUsage.get(p) || 0) + 1);
  }

  let mirrorFilesDeleted = 0;
  for (const [url, meta] of entries) {
    if (!removeUrls.has(url)) continue;
    const p = meta && meta.path;
    delete byUrl[url];
    if (!p) continue;
    if (!pathUsage.has(p)) {
      const abs = path.join(ROOT, p);
      if (unlinkSafe(abs, dryRun)) mirrorFilesDeleted++;
    }
  }

  idx.by_url = byUrl;
  idx.updatedAt = new Date().toISOString();
  if (!dryRun) fs.writeFileSync(MIRROR_INDEX, JSON.stringify(idx, null, 2) + "\n", "utf8");

  return { indexTouched: 1, mirrorFilesDeleted, removedUrls: removeUrls.size };
}

function main() {
  const { dryRun } = parseArgs();
  const a = cleanupRoyalMintJsons(dryRun);
  const b = cleanupMirrorIndex(dryRun);
  console.log("Dry-run:", dryRun ? "yes" : "no");
  console.log("JSON touched:", a.jsonTouched);
  console.log("public/foreign deleted:", a.filesDeleted);
  console.log("Mirror index touched:", b.indexTouched);
  console.log("Mirror urls removed:", b.removedUrls);
  console.log("Mirror files deleted:", b.mirrorFilesDeleted);
}

main();

