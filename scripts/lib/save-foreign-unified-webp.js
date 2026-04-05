/**
 * Сохранение кадра в public/image/coins/foreign/{slug}-{role}.webp
 * (единообразие с migrate / Perth RM convert).
 */
const fs = require("fs");
const path = require("path");
const sharp = require("sharp");
const { unifiedForeignUrl, roleFromIndex } = require("./unified-foreign-image.js");

/** Корень приложения (omonete-app), не scripts/ — иначе файлы попадают в scripts/public и сайт их не видит */
const ROOT = path.join(__dirname, "..", "..");
const MAX_SIDE = 1200;
const WEBP_OPTS = { quality: 82, effort: 6, smartSubsample: true };

/**
 * @param {Buffer} buf
 * @param {string} slug slug монеты (как в URL товара)
 * @param {string|number} roleOrOneBasedIndex роль (obv, rev, …) или номер 1… для roleFromIndex
 */
async function saveBufferAsForeignUnified(buf, slug, roleOrOneBasedIndex) {
  const role =
    typeof roleOrOneBasedIndex === "number" ? roleFromIndex(roleOrOneBasedIndex) : roleOrOneBasedIndex;
  const url = unifiedForeignUrl(slug, role);
  const abs = path.join(ROOT, "public", url.replace(/^\//, ""));
  await fs.promises.mkdir(path.dirname(abs), { recursive: true });
  const out = await sharp(buf)
    .resize(MAX_SIDE, MAX_SIDE, { fit: "inside", withoutEnlargement: true })
    .webp(WEBP_OPTS)
    .toBuffer();
  await fs.promises.writeFile(abs, out);
  return url;
}

module.exports = { saveBufferAsForeignUnified, roleFromIndex, MAX_SIDE, WEBP_OPTS };
