/**
 * Monnaie de Paris: найти на диске webp с малым пиксельным размером (как после старых URL 120×120)
 * и перекачать с актуального URL из data/monnaie-de-paris-*.json (с upgrade до 700 как в каталоге).
 *
 *   node scripts/mdp-redownload-small-webp.js           # dry-run
 *   node scripts/mdp-redownload-small-webp.js --apply
 *
 * Порог: max(width,height) < 400 (типичная миниатюра MDP).
 */
require("dotenv").config({ path: ".env" });
const fs = require("fs");
const path = require("path");
const sharp = require("sharp");
const { upgradeMdpCatalogProductUrl } = require("./mdp-catalog-image-url.js");

const DATA_DIR = path.join(__dirname, "..", "data");
const FOREIGN_DIR = path.join(__dirname, "..", "public", "image", "coins", "foreign");

const MAX_SIDE_THRESHOLD = 400;

function mdpUrlPathKey(u) {
  if (!u || typeof u !== "string") return "";
  try {
    return new URL(u.trim()).pathname.toLowerCase();
  } catch {
    return String(u).split("?")[0].toLowerCase();
  }
}

function mdpPackagingUrlsOnlyExtra(classified) {
  const obv = classified.obverse;
  const rev = classified.reverse;
  const used = new Set([obv, rev].filter(Boolean).map(mdpUrlPathKey).filter(Boolean));
  const packs = classified.packaging;
  if (!Array.isArray(packs) || !packs.length) return [];
  const out = [];
  const seen = new Set();
  for (const p of packs) {
    const u = p && p.url ? String(p.url).trim() : "";
    if (!u) continue;
    const k = mdpUrlPathKey(u);
    if (used.has(k) || seen.has(k)) continue;
    seen.add(k);
    out.push(u);
  }
  return out;
}

/** Не использовать «упаковочный» URL, если он тот же файл, что аверс или реверс (часто в сыром packaging[]). */
function distinctFromObvRev(url, classified) {
  if (!url || typeof classified !== "object") return null;
  const u = String(url).trim();
  const k = mdpUrlPathKey(u);
  const ok = classified.obverse ? mdpUrlPathKey(String(classified.obverse).trim()) : "";
  const rk = classified.reverse ? mdpUrlPathKey(String(classified.reverse).trim()) : "";
  if (!k || k === ok || k === rk) return null;
  return u;
}

function resolveUrlForRole(raw, role) {
  const classified = raw.classified || {};
  const packUrls = mdpPackagingUrlsOnlyExtra(classified);
  const rawPacks = Array.isArray(classified.packaging) ? classified.packaging : [];
  const packRawUrl = (i) => (rawPacks[i] && rawPacks[i].url ? String(rawPacks[i].url).trim() : null);
  const imageUrls = Array.isArray(raw.imageUrls) ? raw.imageUrls : [];
  const gallery = Array.isArray(raw.gallery) ? raw.gallery : [];
  const galleryFull = (i) => {
    const g = gallery[i];
    if (!g || typeof g !== "object") return null;
    const u = g.full || g.img;
    return u ? String(u).trim() : null;
  };

  if (role === "obv") return classified.obverse ? String(classified.obverse).trim() : null;
  if (role === "rev") return classified.reverse ? String(classified.reverse).trim() : null;
  if (role === "pack") {
    if (packUrls[0]) return packUrls[0];
    if (classified.packaging && typeof classified.packaging === "string") {
      return distinctFromObvRev(classified.packaging.trim(), classified);
    }
    const a = distinctFromObvRev(packRawUrl(0), classified);
    if (a) return a;
    if (imageUrls.length >= 3) return distinctFromObvRev(String(imageUrls[2]).trim(), classified);
    return distinctFromObvRev(galleryFull(2), classified);
  }
  if (role === "box") {
    if (packUrls[1]) return packUrls[1];
    const b = distinctFromObvRev(packRawUrl(1), classified);
    if (b) return b;
    if (imageUrls.length >= 4) return distinctFromObvRev(String(imageUrls[3]).trim(), classified);
    return distinctFromObvRev(galleryFull(3), classified);
  }
  return null;
}

async function fetchBuffer(url, timeoutMs = 30000) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      redirect: "follow",
      signal: ac.signal,
      headers: {
        "user-agent": "Mozilla/5.0 (compatible; omonete-bot/1.0)",
        referer: "https://www.monnaiedeparis.fr/",
      },
    });
    if (!res.ok) return null;
    return Buffer.from(await res.arrayBuffer());
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

async function writeWebpFromUrl(absOut, url) {
  const buf = await fetchBuffer(url);
  if (!buf || !buf.length) return { ok: false, err: "fetch" };
  const tmp = `${absOut}.tmp.${process.pid}.${Date.now()}`;
  try {
    await sharp(buf).webp({ quality: 90 }).toFile(tmp);
    fs.renameSync(tmp, absOut);
    return { ok: true };
  } catch (e) {
    try {
      if (fs.existsSync(tmp)) fs.unlinkSync(tmp);
    } catch {
      /* ignore */
    }
    return { ok: false, err: String(e && e.message ? e.message : e) };
  }
}

function parseBasename(base) {
  const m = base.match(/^monnaie-de-paris-(.+)-(obv|rev|pack|box)\.webp$/i);
  if (!m) return null;
  return { slug: m[1], role: m[2].toLowerCase() };
}

async function main() {
  const apply = process.argv.includes("--apply");
  if (!apply) console.log("Dry-run. Применить: --apply\n");

  const files = fs.readdirSync(FOREIGN_DIR).filter((f) => f.startsWith("monnaie-de-paris-") && f.endsWith(".webp"));
  const small = [];
  for (const f of files) {
    const p = path.join(FOREIGN_DIR, f);
    try {
      const m = await sharp(p).metadata();
      const w = m.width || 0;
      const h = m.height || 0;
      if (Math.max(w, h) > 0 && Math.max(w, h) < MAX_SIDE_THRESHOLD) small.push({ f, w, h });
    } catch {
      /* skip */
    }
  }

  console.log("Мелких monnaie-de-paris *.webp (max сторона < %s): %s", MAX_SIDE_THRESHOLD, small.length);

  let ok = 0;
  let skip = 0;

  for (const { f, w, h } of small) {
    const parsed = parseBasename(f);
    if (!parsed) {
      console.warn("Не разобрать имя:", f);
      skip++;
      continue;
    }
    const jsonPath = path.join(DATA_DIR, `monnaie-de-paris-${parsed.slug}.json`);
    if (!fs.existsSync(jsonPath)) {
      console.warn("Нет JSON:", jsonPath);
      skip++;
      continue;
    }
    let raw;
    try {
      raw = JSON.parse(fs.readFileSync(jsonPath, "utf8"));
    } catch (e) {
      console.warn("Битый JSON:", jsonPath, e.message);
      skip++;
      continue;
    }
    let url = resolveUrlForRole(raw, parsed.role);
    if (!url) {
      console.warn("Нет URL для роли", parsed.role, "—", f);
      skip++;
      continue;
    }
    url = upgradeMdpCatalogProductUrl(url);
    const absOut = path.join(FOREIGN_DIR, f);
    if (!apply) {
      console.log("[dry-run]", f, `${w}×${h}`, "→", url.slice(0, 100) + (url.length > 100 ? "…" : ""));
      ok++;
      continue;
    }
    const r = await writeWebpFromUrl(absOut, url);
    if (r.ok) {
      console.log("OK:", f);
      ok++;
    } else {
      console.warn("Ошибка:", f, r.err);
      skip++;
    }
  }

  console.log("—");
  console.log(apply ? "Перекачано:" : "Запланировано:", ok);
  console.log("Пропусков / ошибок:", skip);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
