/**
 * Общие эвристики имён файлов Mennica (как в fetch-mennica-product.js) для Node-скриптов.
 */
function normalizeMennicaImgCanon(u) {
  if (!u || typeof u !== "string") return "";
  try {
    const url = new URL(u);
    const p = url.pathname.replace(/-\d+x\d+(?=\.[^.]+)/gi, "");
    return (url.origin + p).toLowerCase();
  } catch {
    return String(u)
      .split("?")[0]
      .toLowerCase()
      .replace(/-\d+x\d+(?=\.[^.]+)/gi, "");
  }
}

function urlHasFaceToken(u, face) {
  const s = String(u);
  const t = face === "reverse" ? "reverse" : "obverse";
  return new RegExp(`(?:^|[/?#_-])${t}(?:[._/?#-]|_|$)`, "i").test(s);
}

function isPackagingFilename(u) {
  return /[_-](box|cert|certificate|package|packaging|etui|capsule|blister|coa|sleeve|wrapper|kapsul)\b/i.test(
    String(u)
  );
}

function looksLikeCertificate(u) {
  return /(certificate|[_-]cert\b|[_-]coa\b|authenticity)/i.test(String(u));
}

function looksLikeBox(u) {
  return /[_-]box\b/i.test(String(u));
}

function looksLikePackaging(u) {
  return /[_-](package|packaging|etui|sleeve|wrapper)\b/i.test(String(u));
}

function looksLikeBlister(u) {
  return /[_-](blister|capsule|kapsul)\b/i.test(String(u));
}

module.exports = {
  normalizeMennicaImgCanon,
  urlHasFaceToken,
  isPackagingFilename,
  looksLikeCertificate,
  looksLikeBox,
  looksLikePackaging,
  looksLikeBlister,
};
