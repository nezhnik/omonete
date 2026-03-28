/**
 * Только minted bars: докачать картинки по прямым URL из data/pamp-minted-bar-*.json
 * (без браузера и без захода на HTML-страницы pamp.com).
 *
 * Нужны уже готовые JSON с https или локальными путями в classified.
 * Зачем: не гонять Playwright, снизить риск блокировок; после этого — pamp:import:minted-bars.
 *
 * Опционально пауза между файлами (мс): PAMP_IMAGE_DELAY_MS=150
 */
const fs = require("fs");
const path = require("path");
const { materializePampClassified, fetchImageBufferHttp } = require("../lib/pampMaterializeImages.js");

const DATA_DIR = path.join(__dirname, "..", "data");

function normalizeUrl(url) {
  if (!url || typeof url !== "string") return null;
  try {
    const u = new URL(url.trim());
    u.hash = "";
    u.search = "";
    return u.toString().replace(/\/+$/, "");
  } catch {
    return null;
  }
}

function slugFromUrl(url) {
  try {
    const u = new URL(url);
    const parts = u.pathname.split("/").filter(Boolean);
    return parts[parts.length - 1] || "pamp-item";
  } catch {
    return "pamp-item";
  }
}

async function main() {
  const delayMs = Math.max(0, Number(process.env.PAMP_IMAGE_DELAY_MS || 0) || 0);
  const files = fs
    .readdirSync(DATA_DIR)
    .filter((f) => f.startsWith("pamp-minted-bar-") && f.endsWith(".json"))
    .sort();

  if (!files.length) {
    console.error("Нет data/pamp-minted-bar-*.json");
    process.exit(1);
  }

  let ok = 0;
  let fail = 0;
  for (let i = 0; i < files.length; i++) {
    const f = files[i];
    const fp = path.join(DATA_DIR, f);
    let raw;
    try {
      raw = JSON.parse(fs.readFileSync(fp, "utf8"));
    } catch {
      console.warn("Пропуск (битый JSON):", f);
      fail++;
      continue;
    }
    const sourceUrl = normalizeUrl(raw.source_url);
    if (!sourceUrl || !/pamp\.com/i.test(sourceUrl)) {
      console.warn("Пропуск (нет source_url):", f);
      fail++;
      continue;
    }
    const slug = slugFromUrl(sourceUrl);
    if (!raw.classified) raw.classified = {};

    try {
      await materializePampClassified(raw.classified, slug, sourceUrl, (u) =>
        fetchImageBufferHttp(u, sourceUrl)
      );
      fs.writeFileSync(fp, JSON.stringify(raw, null, 2), "utf8");
      ok++;
      console.log(`[${i + 1}/${files.length}] OK`, f);
    } catch (e) {
      console.warn("Ошибка:", f, e.message);
      fail++;
    }

    if (delayMs > 0) await new Promise((r) => setTimeout(r, delayMs));
  }

  console.log("Готово. Успешно:", ok, "с проблемами:", fail);
  console.log("Далее: npm run pamp:import:minted-bars && npm run data:export:incremental");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
