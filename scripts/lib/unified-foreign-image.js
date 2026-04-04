/**
 * Единая схема файлов: /image/coins/foreign/{slug}-{role}.webp
 * slug — каталожный slug монеты (как во вложенной папке или в плоском имени без роли).
 * role: obv | rev | box | pack | cert | blister-obv | blister-rev | img-06 …
 */
const path = require("path");

const PREFIX = "/image/coins/foreign/";

/** Первый сегмент пути для вложенных загрузок bucket/slug/file */
const NESTED_BUCKET_PREFIXES = new Set([
  "royaldutch",
  "scottsdale",
  "swissmint",
  "herdenkings",
  "rcm",
]);

/** Роли в порядке от более длинной к короткой (снятие суффикса с basename) */
const ROLE_SUFFIXES = [
  "blister-obv",
  "blister-rev",
  "blister-obverse",
  "blister-reverse",
  "packaging",
  "certificate",
  "blister",
  "obverse",
  "reverse",
  "obv",
  "rev",
  "pack",
  "cert",
  "box",
  /** MDP и др.: короткие суффиксы — только после полных obv/rev/box */
  "pac",
  "pa",
  "bo",
  "re",
  "ob",
];

/**
 * Номер файла 01, 02… → роль (как у швейцарского/голландского импорта и RCM).
 * @param {number} n 1-based
 */
function roleFromIndex(n) {
  if (n === 1) return "obv";
  if (n === 2) return "rev";
  if (n === 3) return "box";
  if (n === 4) return "pack";
  if (n === 5) return "cert";
  return `img-${String(n).padStart(2, "0")}`;
}

/**
 * stem файла без расширения → роль (для 01, obv, cert…).
 * @param {string} stem
 */
function roleFromFileStem(stem) {
  const s = String(stem || "").trim();
  if (!s) return "obv";
  if (/^\d+$/.test(s)) return roleFromIndex(parseInt(s, 10));
  const lower = s.toLowerCase();
  if (lower === "obv" || lower === "obverse") return "obv";
  if (lower === "rev" || lower === "reverse") return "rev";
  if (lower === "box") return "box";
  if (lower === "pack" || lower === "packaging") return "pack";
  if (lower === "cert" || lower === "certificate") return "cert";
  if (/blister.*obv|obv.*blister/i.test(s)) return "blister-obv";
  if (/blister.*rev|rev.*blister/i.test(s)) return "blister-rev";
  return lower.replace(/[^a-z0-9-]+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "") || "obv";
}

/**
 * Нормализация slug сегмента (нижний регистр, безопасные символы).
 */
function normalizeSlug(s) {
  return String(s || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

/**
 * С плоского basename «slug-role» или просто «slug» извлечь { slug, role }.
 */
function parseFlatBasename(basenameNoExt) {
  const raw = String(basenameNoExt || "").trim();
  const lower = raw.toLowerCase();
  for (const role of ROLE_SUFFIXES) {
    const suf = `-${role}`;
    if (lower.endsWith(suf)) {
      const slugPart = raw.slice(0, raw.length - suf.length);
      let r =
        role === "packaging"
          ? "pack"
          : role === "certificate"
            ? "cert"
            : role === "blister-obverse"
              ? "blister-obv"
              : role === "blister-reverse"
                ? "blister-rev"
                : role === "obverse"
                  ? "obv"
                  : role === "reverse"
                    ? "rev"
                    : role === "ob"
                      ? "obv"
                      : role === "re"
                        ? "rev"
                        : role === "pa" || role === "pac"
                          ? "pack"
                          : role === "bo"
                            ? "box"
                            : role;
      return { slug: normalizeSlug(slugPart), role: r };
    }
  }
  return { slug: normalizeSlug(raw), role: "obv" };
}

function normalizeRoleToken(role) {
  const x = String(role || "obv").toLowerCase();
  if (x === "packaging") return "pack";
  if (x === "certificate") return "cert";
  if (x === "blister-obverse") return "blister-obv";
  if (x === "blister-reverse") return "blister-rev";
  if (x === "obverse") return "obv";
  if (x === "reverse") return "rev";
  return x;
}

/**
 * Полный публичный URL.
 */
function unifiedForeignUrl(slug, role) {
  return `${PREFIX}${normalizeSlug(slug)}-${normalizeRoleToken(role)}.webp`;
}

/**
 * Разбор существующего URL → { slug, role } для целевого имени или null.
 * @param {string} url
 */
function parseLegacyForeignUrl(url) {
  if (url == null || typeof url !== "string") return null;
  const u = url.trim().split("?")[0];
  if (!u.startsWith(PREFIX)) return null;
  const rel = u.slice(PREFIX.length);
  const segments = rel.split("/").filter(Boolean);
  if (segments.length === 0) return null;

  if (segments.length >= 3) {
    const bucket = segments[0].toLowerCase();
    if (!NESTED_BUCKET_PREFIXES.has(bucket)) return null;
    const slug = normalizeSlug(segments[1]);
    const file = segments[segments.length - 1];
    const stem = path.basename(file, path.extname(file));
    const role = roleFromFileStem(stem);
    return { slug, role };
  }

  if (segments.length === 1) {
    const file = segments[0];
    const ext = path.extname(file).toLowerCase();
    const stem = path.basename(file, path.extname(file));
    if (!ext) return null;
    return parseFlatBasename(stem);
  }

  return null;
}

/**
 * Целевой URL для legacy пути.
 */
function legacyToUnifiedUrl(url) {
  const p = parseLegacyForeignUrl(url);
  if (!p) return null;
  return unifiedForeignUrl(p.slug, p.role);
}

module.exports = {
  PREFIX,
  NESTED_BUCKET_PREFIXES,
  ROLE_SUFFIXES,
  roleFromIndex,
  roleFromFileStem,
  normalizeSlug,
  parseFlatBasename,
  unifiedForeignUrl,
  parseLegacyForeignUrl,
  legacyToUnifiedUrl,
};
