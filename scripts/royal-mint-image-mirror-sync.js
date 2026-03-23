/**
 * Синхронизация зеркала картинок Royal Mint по manifest:
 * - качает прямые URL из roles (obverse/reverse/box/cert/blister*)
 * - сохраняет webp в data/royal-mint-image-mirror/<slug>-<role>.webp
 * - индексирует url/hash/path в data/royal-mint-image-mirror-index.json
 *
 * Запуск:
 *   node scripts/royal-mint-image-mirror-sync.js
 *   node scripts/royal-mint-image-mirror-sync.js --dry-run
 *   node scripts/royal-mint-image-mirror-sync.js --force
 *   node scripts/royal-mint-image-mirror-sync.js --limit 100
 */
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const sharp = require("sharp");

const ROOT = path.join(__dirname, "..");
const DATA_DIR = path.join(ROOT, "data");
const MANIFEST = path.join(DATA_DIR, "royal-mint-image-manifest.json");
const MIRROR_DIR = path.join(DATA_DIR, "royal-mint-image-mirror");
const INDEX_PATH = path.join(DATA_DIR, "royal-mint-image-mirror-index.json");

function parseArgs() {
  const dryRun = process.argv.includes("--dry-run");
  const force = process.argv.includes("--force");
  const li = process.argv.indexOf("--limit");
  const limit = li >= 0 && process.argv[li + 1] ? parseInt(process.argv[li + 1], 10) : 0;
  return { dryRun, force, limit: Number.isFinite(limit) && limit > 0 ? limit : 0 };
}

function sha1(buf) {
  return crypto.createHash("sha1").update(buf).digest("hex");
}

async function downloadToWebp(url, outAbs) {
  const res = await fetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
      Accept: "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
    },
    redirect: "follow",
  });
  if (!res.ok) throw new Error(`http_${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length < 500) throw new Error("too_small");
  const webpBuf = await sharp(buf)
    .resize(1600, 1600, { fit: "inside", withoutEnlargement: true })
    .webp({ quality: 84, effort: 6, smartSubsample: true })
    .toBuffer();
  fs.writeFileSync(outAbs, webpBuf);
  return webpBuf;
}

async function main() {
  const { dryRun, force, limit } = parseArgs();
  if (!fs.existsSync(MANIFEST)) {
    console.error("Нет manifest:", MANIFEST);
    process.exit(1);
  }
  const manifest = JSON.parse(fs.readFileSync(MANIFEST, "utf8"));
  const entries = Array.isArray(manifest.entries) ? manifest.entries : [];

  let index = { createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), by_url: {}, by_hash: {} };
  if (fs.existsSync(INDEX_PATH)) {
    try {
      index = JSON.parse(fs.readFileSync(INDEX_PATH, "utf8"));
      if (!index.by_url) index.by_url = {};
      if (!index.by_hash) index.by_hash = {};
    } catch {
      /* keep default */
    }
  }

  fs.mkdirSync(MIRROR_DIR, { recursive: true });

  const jobs = [];
  const roleKeys = ["obverse", "reverse", "blister_obverse", "blister_reverse", "box", "certificate"];
  for (const e of entries) {
    const roles = e.roles || {};
    for (const role of roleKeys) {
      const url = String(roles[role] || "").trim();
      if (!url) continue;
      jobs.push({
        slug: e.slug || "royal-mint-coin",
        role,
        url,
      });
    }
  }

  // URL dedupe for network friendliness.
  const byUrl = new Map();
  for (const j of jobs) {
    if (!byUrl.has(j.url)) byUrl.set(j.url, []);
    byUrl.get(j.url).push(j);
  }
  let uniqueJobs = [...byUrl.entries()].map(([url, refs]) => ({ url, refs }));
  if (limit > 0) uniqueJobs = uniqueJobs.slice(0, limit);

  let downloaded = 0;
  let skipped = 0;
  let failed = 0;

  for (const item of uniqueJobs) {
    const { url, refs } = item;
    const first = refs[0];
    const file = `${first.slug}-${first.role}.webp`.replace(/[^a-z0-9._-]/gi, "-");
    const outAbs = path.join(MIRROR_DIR, file);

    if (!force && fs.existsSync(outAbs)) {
      skipped += refs.length;
      for (const ref of refs) {
        const f = `${ref.slug}-${ref.role}.webp`.replace(/[^a-z0-9._-]/gi, "-");
        const p = path.join(MIRROR_DIR, f);
        index.by_url[ref.url] = { path: path.relative(ROOT, p), role: ref.role, slug: ref.slug };
      }
      continue;
    }

    if (dryRun) {
      console.log("[dry-run]", url, "=>", path.relative(ROOT, outAbs));
      skipped += refs.length;
      continue;
    }

    try {
      const webpBuf = await downloadToWebp(url, outAbs);
      const hash = sha1(webpBuf);
      index.by_hash[hash] = { path: path.relative(ROOT, outAbs), size: webpBuf.length };
      for (const ref of refs) {
        const f = `${ref.slug}-${ref.role}.webp`.replace(/[^a-z0-9._-]/gi, "-");
        const p = path.join(MIRROR_DIR, f);
        if (p !== outAbs && !fs.existsSync(p)) {
          fs.copyFileSync(outAbs, p);
        }
        index.by_url[ref.url] = { path: path.relative(ROOT, p), role: ref.role, slug: ref.slug, hash };
      }
      downloaded += refs.length;
      console.log("✓", refs.length, "ref(s)", path.basename(outAbs));
    } catch (e) {
      failed += refs.length;
      console.warn("✗", refs.length, "ref(s)", e.message, url.slice(0, 140));
    }
  }

  index.updatedAt = new Date().toISOString();
  fs.writeFileSync(INDEX_PATH, JSON.stringify(index, null, 2), "utf8");
  console.log("\nMirror dir :", MIRROR_DIR);
  console.log("Index file :", INDEX_PATH);
  console.log("Downloaded :", downloaded);
  console.log("Skipped    :", skipped);
  console.log("Failed     :", failed);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

