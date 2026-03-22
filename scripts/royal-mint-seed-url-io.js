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
    const norm = u.split("#")[0].replace(/\/+$/, "") || u;
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

module.exports = { extractRoyalMintUrlsFromText, readSeedUrlsFromFile };
