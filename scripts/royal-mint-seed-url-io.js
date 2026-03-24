/**
 * Чтение URL The Royal Mint из текстового файла:
 * — строки, начинающиеся с https://
 * — или вставленный HTML (href="//www.royalmint.com/...")
 */
const fs = require("fs");

function extractRoyalMintUrlsFromText(text) {
  const seen = new Set();
  const add = (u) => {
    if (!u || !/^https?:\/\/(www\.)?royalmint\.com\//i.test(u)) return;
    let norm = u.split("#")[0].replace(/\/+$/, "").replace(/&amp;/gi, "&") || u;
    // Из HTML часто цепляются src картинок, а не страницы монет
    if (/\/globalassets\//i.test(norm)) return;
    if (/\.(jpg|jpeg|png|webp|gif|svg)(\?|$)/i.test(norm)) return;
    if (!seen.has(norm)) seen.add(norm);
  };
  const s = String(text);
  const reHttps = /https?:\/\/(?:www\.)?royalmint\.com[^"'>\s)\]]+/gi;
  let m;
  while ((m = reHttps.exec(s)) !== null) add(m[0]);
  const reProto = /\/\/(?:www\.)?royalmint\.com[^"'>\s)\]]+/gi;
  while ((m = reProto.exec(s)) !== null) add("https:" + m[0]);
  return [...seen];
}

/**
 * Карточки PLP Royal Mint часто дают href="/shop/..." без домена — полный URL в тексте не встречается.
 */
function extractRoyalMintRelativeProductUrls(text) {
  const seen = new Set();
  const addAbs = (pathAndQuery) => {
    if (!pathAndQuery || typeof pathAndQuery !== "string") return;
    let p = pathAndQuery.trim().split("#")[0].replace(/&amp;/gi, "&");
    if (!p.startsWith("/")) return;
    if (/^\/globalassets\//i.test(p)) return;
    if (/\.(jpg|jpeg|png|webp|gif|svg|ico|css|js|woff2?)(\?|$)/i.test(p)) return;
    if (/^\/(cart|checkout|basket|my-account|login|register|sitecore|api|search)\b/i.test(p)) return;
    const parts = p.split("/").filter(Boolean);
    if (parts.length < 2) return;
    try {
      const u = new URL("https://www.royalmint.com" + p);
      u.hash = "";
      const norm = u.toString().replace(/\/$/, "");
      if (!seen.has(norm)) seen.add(norm);
    } catch {
      /* ignore */
    }
  };
  const s = String(text);
  const reDq = /\bhref\s*=\s*"(\/[^"]*)"/gi;
  const reSq = /\bhref\s*=\s*'(\/[^']*)'/gi;
  let m;
  while ((m = reDq.exec(s)) !== null) addAbs(m[1]);
  while ((m = reSq.exec(s)) !== null) addAbs(m[1]);
  return [...seen];
}

/** Абсолютные + относительные ссылки из сохранённого HTML (PLP / фрагмент карточек). */
function extractRoyalMintUrlsFromHtmlFile(filePath) {
  if (!fs.existsSync(filePath)) return [];
  const raw = fs.readFileSync(filePath, "utf8");
  const abs = extractRoyalMintUrlsFromText(raw);
  const rel = extractRoyalMintRelativeProductUrls(raw);
  const merged = new Set([...abs, ...rel]);
  return [...merged];
}

function readSeedUrlsFromFile(filePath) {
  if (!fs.existsSync(filePath)) {
    console.error("Нет файла:", filePath);
    return [];
  }
  const lines = fs.readFileSync(filePath, "utf8").split(/\r?\n/);
  const out = [];
  const seen = new Set();
  for (const line of lines) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    if (t.startsWith("http") || t.includes("royalmint.com")) {
      extractRoyalMintUrlsFromText(t).forEach((u) => {
        if (!seen.has(u)) {
          seen.add(u);
          out.push(u);
        }
      });
    }
  }
  return out;
}

module.exports = {
  extractRoyalMintUrlsFromText,
  extractRoyalMintRelativeProductUrls,
  extractRoyalMintUrlsFromHtmlFile,
  readSeedUrlsFromFile,
};
