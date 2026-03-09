/**
 * Скачивает все изображения с https://www.pixelur.com/Kookaburra.html
 * в папку public/image/coins/kookaburra-pixelur/
 * Владелец сайта разрешил использование.
 *
 * Запуск: node scripts/download-pixelur-kookaburra-images.js
 */
const fs = require("fs");
const path = require("path");
const https = require("https");

const PAGE_URL = "https://www.pixelur.com/Kookaburra.html";
const OUT_DIR = path.join(__dirname, "..", "public", "image", "coins", "kookaburra-pixelur");

function getUrlPath(url) {
  try {
    return new URL(url).pathname.replace(/^\//, "");
  } catch {
    return null;
  }
}

function get(url) {
  return new Promise((resolve, reject) => {
    https
      .get(
        url,
        { headers: { "User-Agent": "Mozilla/5.0 (compatible; Omonete/1)" } },
        (res) => {
          if (res.statusCode === 301 || res.statusCode === 302) {
            get(res.headers.location).then(resolve).catch(reject);
            return;
          }
          const chunks = [];
          res.on("data", (c) => chunks.push(c));
          res.on("end", () => resolve(Buffer.concat(chunks)));
        }
      )
      .on("error", reject);
  });
}

function download(url) {
  return new Promise((resolve, reject) => {
    const file = getUrlPath(url) || path.basename(url);
    const outPath = path.join(OUT_DIR, file);
    const dir = path.dirname(outPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    https
      .get(
        url,
        { headers: { "User-Agent": "Mozilla/5.0 (compatible; Omonete/1)" } },
        (res) => {
          if (res.statusCode === 301 || res.statusCode === 302) {
            download(res.headers.location).then(resolve).catch(reject);
            return;
          }
          if (res.statusCode !== 200) {
            reject(new Error(url + " " + res.statusCode));
            return;
          }
          const chunks = [];
          res.on("data", (c) => chunks.push(c));
          res.on("end", () => {
            fs.writeFileSync(outPath, Buffer.concat(chunks));
            resolve(outPath);
          });
        }
      )
      .on("error", reject);
  });
}

async function main() {
  const html = (await get(PAGE_URL)).toString();
  const urls = [...html.matchAll(/src="(https?:\/\/[^"]+\.(?:jpg|jpeg|png|gif|webp))"/gi)].map(
    (m) => m[1]
  );
  const unique = [...new Set(urls)].filter((u) => u.includes("pixelur.com"));

  if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });
  console.log("Папка:", OUT_DIR);
  console.log("Найдено изображений:", unique.length);

  let ok = 0;
  let err = 0;
  for (const url of unique) {
    try {
      await download(url);
      console.log("  ✓", path.basename(getUrlPath(url) || url));
      ok++;
    } catch (e) {
      console.warn("  ✗", url, e.message);
      err++;
    }
  }
  console.log("\nГотово: скачано", ok, ", ошибок", err);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
