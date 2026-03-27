/**
 * Догружает картинки для уже сохранённых data/pamp-minted-bar-*.json или pamp-cast-bar-*.json (--cast-bars).
 * Ссылки в classified уже есть; скачивание через fetch на странице после goto (как у основного fetch).
 *
 * Minted: npm run pamp:minted-bars:materialize-json → import minted → export
 * Cast:   npm run pamp:cast-bars:materialize-json → import cast-bars → export
 */
const fs = require("fs");
const path = require("path");
const {
  materializePampClassified,
  snapshotClassifiedSourceUrls,
  verifyClassifiedFiles,
} = require("../lib/pampMaterializeImages.js");
const {
  launchPampBrowser,
  normalizeUrl,
  slugFromUrl,
  pampImageBufferFromPage,
} = require("./fetch-pamp-product.js");

const DATA_DIR = path.join(__dirname, "..", "data");

function resolvePrefixAndLabel() {
  const cast = process.argv.includes("--cast-bars");
  return {
    filePrefix: cast ? "pamp-cast-bar-" : "pamp-minted-bar-",
    label: cast ? "cast bars" : "minted bars",
  };
}

function listBarJsonFiles(filePrefix) {
  return fs
    .readdirSync(DATA_DIR)
    .filter((f) => f.startsWith(filePrefix) && f.endsWith(".json"))
    .sort();
}

function needsMaterialize(classified) {
  if (!classified || typeof classified !== "object") return false;
  return Object.values(classified).some((v) => typeof v === "string" && /^https?:\/\//i.test(v.trim()));
}

function slugFromBarFilename(filename, filePrefix) {
  return filename.slice(filePrefix.length, -5);
}

async function main() {
  const { filePrefix, label } = resolvePrefixAndLabel();
  if (!fs.existsSync(DATA_DIR)) {
    console.error("Нет папки data");
    process.exit(1);
  }
  const files = listBarJsonFiles(filePrefix);
  if (!files.length) {
    console.error(`Нет ${filePrefix}*.json в data/`);
    process.exit(1);
  }

  const todo = files.filter((f) => {
    const p = path.join(DATA_DIR, f);
    const j = JSON.parse(fs.readFileSync(p, "utf8"));
    return needsMaterialize(j.classified);
  });

  console.log(`Всего ${label} JSON:`, files.length, "| нужны картинки:", todo.length);
  if (!todo.length) {
    console.log("Все classified уже локальные пути — выход.");
    return;
  }

  let browser;
  let ok = 0;
  let fail = 0;
  try {
    const launched = await launchPampBrowser();
    browser = launched.browser;
    const { page } = launched;

    for (let i = 0; i < todo.length; i++) {
      const f = todo[i];
      const filePath = path.join(DATA_DIR, f);
      const raw = JSON.parse(fs.readFileSync(filePath, "utf8"));
      const sourceUrl = raw.source_url ? normalizeUrl(raw.source_url) : null;
      if (!sourceUrl || !/^https?:\/\//i.test(sourceUrl)) {
        console.error(`[${i + 1}/${todo.length}] ${f} — нет source_url`);
        fail++;
        continue;
      }

      const slug = slugFromUrl(sourceUrl) || slugFromBarFilename(f, filePrefix);
      console.log(`[${i + 1}/${todo.length}] ${slug}`);

      try {
        await page.goto(sourceUrl, { waitUntil: "networkidle", timeout: 90000 });
        await page.waitForTimeout(2000);

        if (!raw.classified_source_urls || !Object.keys(raw.classified_source_urls).length) {
          raw.classified_source_urls = snapshotClassifiedSourceUrls(raw.classified);
        }

        await materializePampClassified(raw.classified, slug, sourceUrl, (imageUrl) =>
          pampImageBufferFromPage(page, imageUrl)
        );

        raw.image_materialize = verifyClassifiedFiles(raw.classified);
        fs.writeFileSync(filePath, JSON.stringify(raw, null, 2), "utf8");

        if (raw.image_materialize.ok) ok++;
        else {
          fail++;
          console.error("  verify FAIL:", JSON.stringify(raw.image_materialize.issues));
          if (process.env.PAMP_STRICT_IMAGES === "1") process.exitCode = 1;
        }
      } catch (e) {
        console.error(e);
        fail++;
      }
    }
  } finally {
    if (browser) await browser.close();
  }

  console.log("Готово. Успешно (verify ok):", ok, "| с ошибками/не всё скачалось:", fail);
  if (fail > 0 && process.env.PAMP_STRICT_IMAGES === "1") process.exit(1);
}

if (require.main === module) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
