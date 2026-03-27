/**
 * Сохранение картинок PAMP на диск (public/image/coins/foreign/*.webp).
 * В JSON поля classified становятся путями /image/coins/foreign/...
 *
 * Важно: CDN pamp.com/sites/... часто отвечает 403 на «голый» fetch без cookies;
 * для скачивания передавайте fetchBuffer из Playwright context.request в той же сессии, что и page.goto.
 * fetchImageBufferHttp оставлен для редких URL, где прямой GET допустим.
 */
const fs = require("fs");
const path = require("path");
const sharp = require("sharp");

const FOREIGN_IMG_DIR = path.join(__dirname, "..", "public", "image", "coins", "foreign");
const PUBLIC_ROOT = path.join(__dirname, "..", "public");

const CLASSIFIED_KEYS = [
  ["obverse", "obv"],
  ["reverse", "rev"],
  ["blister_obverse", "blister-obv"],
  ["blister_reverse", "blister-rev"],
  ["packaging", "packaging"],
  ["box", "box"],
  ["certificate", "certificate"],
];

/** Снимок удалённых URL по classified до materialize (аудит, повторная выкладка). */
function snapshotClassifiedSourceUrls(classified) {
  if (!classified || typeof classified !== "object") return {};
  const out = {};
  for (const [key] of CLASSIFIED_KEYS) {
    const raw = classified[key];
    if (raw == null || typeof raw !== "string") continue;
    const u = raw.trim();
    if (!u || !/^https?:\/\//i.test(u)) continue;
    out[key] = u;
  }
  return out;
}

/**
 * Локальные пути — непустой файл на диске; https в classified — не materialize.
 * @returns {{ ok: boolean, issues: Array<{key: string, problem: string, path?: string, url?: string}>, checkedAt: string }}
 */
function verifyClassifiedFiles(classified) {
  const issues = [];
  let ok = true;
  if (!classified || typeof classified !== "object") {
    return { ok: true, issues: [], checkedAt: new Date().toISOString() };
  }
  for (const [key] of CLASSIFIED_KEYS) {
    const v = classified[key];
    if (v == null || typeof v !== "string") continue;
    const s = v.trim();
    if (!s) continue;
    if (s.startsWith("/image/coins/foreign/")) {
      const abs = path.join(PUBLIC_ROOT, s.replace(/^\//, ""));
      if (!fs.existsSync(abs)) {
        issues.push({ key, problem: "missing_file", path: abs });
        ok = false;
        continue;
      }
      const st = fs.statSync(abs);
      if (st.size <= 0) {
        issues.push({ key, problem: "empty_file", path: abs });
        ok = false;
      }
    } else if (/^https?:\/\//i.test(s)) {
      issues.push({ key, problem: "still_remote_url", url: s });
      ok = false;
    }
  }
  return { ok, issues, checkedAt: new Date().toISOString() };
}

function ensureDir(p) {
  if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
}

function sanitizeFilePart(v) {
  return String(v || "")
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 120);
}

/** Прямой GET картинки по URL (не открываем HTML страницы pamp). */
async function fetchImageBufferHttp(imageUrl, refererPageUrl) {
  const referer =
    refererPageUrl && /^https?:\/\//i.test(String(refererPageUrl).trim())
      ? String(refererPageUrl).trim()
      : "https://www.pamp.com/";
  try {
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), 30000);
    const res = await fetch(imageUrl, {
      method: "GET",
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        Referer: referer,
        Accept: "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
      },
      redirect: "follow",
      signal: ac.signal,
    });
    clearTimeout(t);
    if (!res.ok) return null;
    const ab = await res.arrayBuffer();
    const buf = Buffer.from(ab);
    return buf.length > 0 ? buf : null;
  } catch {
    return null;
  }
}

/**
 * @param {Record<string,string|null>} classified
 * @param {string} slug slug товара (последний сегмент URL)
 * @param {string} sourceUrl страница товара (Referer)
 * @param {(url: string) => Promise<Buffer|null>} fetchBuffer
 */
async function materializePampClassified(classified, slug, sourceUrl, fetchBuffer) {
  if (!classified || typeof classified !== "object" || typeof fetchBuffer !== "function") return;
  const safeSlug = sanitizeFilePart(slug) || "pamp-item";
  ensureDir(FOREIGN_IMG_DIR);

  for (const [key, suffix] of CLASSIFIED_KEYS) {
    const raw = classified[key];
    if (raw == null || typeof raw !== "string") continue;
    const u = raw.trim();
    if (!u) continue;
    if (u.startsWith("/image/coins/foreign/")) continue;
    if (!/^https?:\/\//i.test(u)) continue;

    const base = `${safeSlug}-${suffix}`;
    const fileName = `${sanitizeFilePart(base) || base}.webp`;
    const absOut = path.join(FOREIGN_IMG_DIR, fileName);
    const relOut = `/image/coins/foreign/${fileName}`;

    if (fs.existsSync(absOut) && fs.statSync(absOut).size > 0) {
      classified[key] = relOut;
      continue;
    }

    const buf = await fetchBuffer(u);
    if (!buf || buf.length === 0) continue;
    try {
      await sharp(buf).webp({ quality: 90 }).toFile(absOut);
      if (fs.existsSync(absOut) && fs.statSync(absOut).size > 0) classified[key] = relOut;
    } catch {
      // оставляем URL в JSON — импорт без этой картинки
    }
  }
}

module.exports = {
  FOREIGN_IMG_DIR,
  materializePampClassified,
  fetchImageBufferHttp,
  sanitizeFilePart,
  ensureDir,
  snapshotClassifiedSourceUrls,
  verifyClassifiedFiles,
};
