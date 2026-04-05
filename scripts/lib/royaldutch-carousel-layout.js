/**
 * Royal Dutch Mint: порядок слайдов карусели не одинаков (иногда box→obv→rev→pack, иногда obv→rev→box…).
 * Выбор схемы: 1) data/royaldutch-carousel-layout.json, 2) alt/title у img, 3) эвристика «монета на белом» по буферу.
 */
const fs = require("fs");
const path = require("path");
const sharp = require("sharp");

const ROOT = path.join(__dirname, "..", "..");
const LAYOUT_FILE = path.join(ROOT, "data", "royaldutch-carousel-layout.json");

const LAYOUT_SEQUENCES = {
  "coin-first": ["obv", "rev", "pack", "box", "cert", "blister-obv", "blister-rev"],
  "box-first": ["box", "obv", "rev", "pack", "cert", "blister-obv", "blister-rev"],
  "coin-box-third": ["obv", "rev", "box", "pack", "cert", "blister-obv", "blister-rev"],
};

const VALID = new Set(Object.keys(LAYOUT_SEQUENCES));

function variance(arr) {
  if (arr.length < 2) return 0;
  const m = arr.reduce((a, b) => a + b, 0) / arr.length;
  return arr.reduce((s, x) => s + (x - m) * (x - m), 0) / arr.length;
}

async function scoreCoinStudioLikelihood(buf) {
  if (!buf || buf.length < 32) return 0;
  let data;
  let info;
  try {
    const o = await sharp(buf)
      .resize(256, 256, { fit: "contain", background: { r: 255, g: 255, b: 255 } })
      .removeAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    data = o.data;
    info = o.info;
  } catch {
    return 0;
  }
  const w = info.width;
  const h = info.height;
  const border = Math.max(8, Math.floor(Math.min(w, h) * 0.06));
  const borderLum = [];
  const centerLum = [];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 3;
      const lum = (data[i] + data[i + 1] + data[i + 2]) / 3;
      const onBorder = x < border || x >= w - border || y < border || y >= h - border;
      const dx = x - w / 2;
      const dy = y - h / 2;
      const inCenter = dx * dx + dy * dy < Math.pow(Math.min(w, h) * 0.32, 2);
      if (onBorder) borderLum.push(lum);
      if (inCenter) centerLum.push(lum);
    }
  }
  const bMean = borderLum.length ? borderLum.reduce((a, b) => a + b, 0) / borderLum.length : 0;
  const cMean = centerLum.length ? centerLum.reduce((a, b) => a + b, 0) / centerLum.length : 0;
  const cVar = variance(centerLum);
  const s1 = Math.min(1, bMean / 240);
  const s2 = Math.min(1, Math.max(0, (bMean - cMean) / 75) * 0.85 + 0.15);
  const s3 = Math.min(1, cVar / 900);
  return Math.max(0, Math.min(1, 0.38 * s1 + 0.34 * s2 + 0.28 * s3));
}

function layoutFromDomHints(frames) {
  if (!Array.isArray(frames) || frames.length < 2) return null;
  const h0 = String(frames[0]?.hint || "").toLowerCase();
  const h1 = String(frames[1]?.hint || "").toLowerCase();
  const coinWord = /obverse|reverse|obv|rev|voorzijde|achterzijde|\bcoin\b|\bmunt\b/i;
  const boxWord = /\bbox\b|case|gift|tin|doos|etui|presentation/i;
  const h0Coin = coinWord.test(h0);
  const h0Box = boxWord.test(h0) && !h0Coin;
  const h1Coin = coinWord.test(h1);
  if (h0Box && h1Coin) return "box-first";
  return null;
}

function inferLayoutFromScores(scores) {
  const s0 = scores[0] ?? 0;
  const s1 = scores[1] ?? 0;
  const s2 = scores[2] ?? 0;
  if (s0 < 0.4 && s1 > 0.42 && s2 > 0.42) return "box-first";
  if (s0 > 0.42 && s1 > 0.42 && s2 < 0.4 && s2 < s0 - 0.05 && s2 < s1 - 0.05) return "coin-box-third";
  return "coin-first";
}

function loadLayoutOverrides() {
  try {
    if (!fs.existsSync(LAYOUT_FILE)) return {};
    const j = JSON.parse(fs.readFileSync(LAYOUT_FILE, "utf8"));
    const out = {};
    for (const [k, v] of Object.entries(j)) {
      if (k.startsWith("_")) continue;
      if (typeof v === "string" && VALID.has(v)) out[k] = v;
    }
    return out;
  } catch {
    return {};
  }
}

/**
 * @param {string} slug
 * @param {{url:string,hint?:string}[]} frames
 * @param {(Buffer|null)[]} buffers — те же индексы, что frames
 */
async function getRoleSequence(slug, frames, buffers) {
  const overrides = loadLayoutOverrides();
  if (slug && overrides[slug]) {
    const layout = overrides[slug];
    return { layout, roles: [...LAYOUT_SEQUENCES[layout]] };
  }

  const fromHints = layoutFromDomHints(frames);
  if (fromHints) {
    return { layout: fromHints, roles: [...LAYOUT_SEQUENCES[fromHints]] };
  }

  const n = Math.min(4, buffers.length);
  const scores = [];
  for (let i = 0; i < n; i++) {
    const b = buffers[i];
    scores.push(b && b.length ? await scoreCoinStudioLikelihood(b) : 0);
  }
  while (scores.length < 3) scores.push(0);
  const layout = inferLayoutFromScores(scores);
  return { layout, roles: [...LAYOUT_SEQUENCES[layout]] };
}

module.exports = {
  LAYOUT_SEQUENCES,
  LAYOUT_FILE,
  loadLayoutOverrides,
  scoreCoinStudioLikelihood,
  layoutFromDomHints,
  inferLayoutFromScores,
  getRoleSequence,
};
