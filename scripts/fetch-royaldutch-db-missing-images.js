/**
 * Монеты Royal Dutch Mint в БД: есть source_url, пустой image_obverse.
 * Качаем карточку с royaldutchmint.com (Playwright, логика как в fetch-royaldutch-product.js),
 * переименовываем 01.jpg → obv / rev / pack / … и обновляем только поля картинок в MySQL.
 *
 *   node scripts/fetch-royaldutch-db-missing-images.js           — сухой прогон (список URL)
 *   node scripts/fetch-royaldutch-db-missing-images.js --apply    — загрузка + UPDATE
 */
require("dotenv").config({ path: ".env" });
const fs = require("fs");
const path = require("path");
const mysql = require("mysql2/promise");
const { fetchOneWithPage, normalizeUrl, slugFromUrl } = require("./fetch-royaldutch-product.js");

const ROOT = path.join(__dirname, "..");
const IMG_DIR = path.join(ROOT, "public", "image", "coins", "foreign", "royaldutch");
const ROLE_NAMES = ["obv", "rev", "pack", "box", "cert", "blister-obv", "blister-rev", "extra-8", "extra-9", "extra-10"];

function getDbConfig() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL не задан");
  const m = url.match(/mysql:\/\/([^:]+):([^@]+)@([^:]+):(\d+)\/(.+)/);
  if (!m) throw new Error("Неверный формат DATABASE_URL");
  const [, user, password, host, port, database] = m;
  return { host, port: Number(port), user, password, database };
}

function emptyProductImageDir(slug) {
  const dir = path.join(IMG_DIR, slug);
  if (!fs.existsSync(dir)) return;
  for (const f of fs.readdirSync(dir)) fs.unlinkSync(path.join(dir, f));
}

function patchDataJson(slug, urlsLocal, obv, rev, pack, box) {
  const jsonPath = path.join(ROOT, "data", `royaldutch-mint-${slug}.json`);
  if (!fs.existsSync(jsonPath)) return;
  const doc = JSON.parse(fs.readFileSync(jsonPath, "utf8"));
  const c = doc.coin || {};
  c.imageUrls = urlsLocal;
  c.image_obverse = obv;
  c.image_reverse = rev;
  c.image_packaging = pack;
  c.image_box = box;
  doc.coin = c;
  fs.writeFileSync(jsonPath, JSON.stringify(doc, null, 2), "utf8");
}

function renameNumericToRoles(slug) {
  const dir = path.join(IMG_DIR, slug);
  if (!fs.existsSync(dir)) return null;
  const numeric = fs
    .readdirSync(dir)
    .filter((f) => /^\d+\./.test(f))
    .sort((a, b) => parseInt(a, 10) - parseInt(b, 10));
  if (!numeric.length) return null;
  const tmp = numeric.map((f, i) => ({ from: f, tmp: `.__ren_${i}_${f}` }));
  for (const { from, tmp: t } of tmp) fs.renameSync(path.join(dir, from), path.join(dir, t));
  const urls = [];
  for (let i = 0; i < tmp.length; i++) {
    const ext = path.extname(tmp[i].tmp.replace(/^.__ren_\d+_/, ""));
    const role = ROLE_NAMES[i] || `extra-${i + 1}`;
    const finalName = `${role}${ext}`;
    fs.renameSync(path.join(dir, tmp[i].tmp), path.join(dir, finalName));
    urls.push(`/image/coins/foreign/royaldutch/${slug}/${finalName}`);
  }
  return urls;
}

async function main() {
  const apply = process.argv.includes("--apply");
  const conn = await mysql.createConnection(getDbConfig());
  const [rows] = await conn.execute(
    `SELECT id, source_url FROM coins
     WHERE (mint = 'Royal Dutch Mint' OR mint_short = 'Royal Dutch Mint')
       AND source_url IS NOT NULL AND TRIM(source_url) != ''
       AND (image_obverse IS NULL OR TRIM(image_obverse) = '')
     ORDER BY id`
  );

  const byNorm = new Map();
  for (const r of rows) {
    const n = normalizeUrl(String(r.source_url).trim());
    if (!byNorm.has(n)) byNorm.set(n, []);
    byNorm.get(n).push(Number(r.id));
  }

  console.log(JSON.stringify({ coins: rows.length, uniqueUrls: byNorm.size, apply }, null, 2));
  for (const [u, ids] of byNorm) console.log(ids.join(","), u);

  if (!apply) {
    await conn.end();
    console.log("\nСухой прогон. Для загрузки и UPDATE: --apply");
    return;
  }

  const { chromium } = require("playwright-extra");
  const StealthPlugin = require("puppeteer-extra-plugin-stealth");
  chromium.use(StealthPlugin());
  const browser = await chromium.launch({ headless: process.env.HEADLESS !== "0", args: ["--no-sandbox"] });
  const context = await browser.newContext({
    locale: "en-GB",
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    viewport: { width: 1400, height: 900 },
  });
  const page = await context.newPage();

  let ok = 0;
  let fail = 0;
  const urls = [...byNorm.keys()];
  for (let i = 0; i < urls.length; i++) {
    const rawUrl = urls[i];
    const ids = byNorm.get(rawUrl);
    const slug = slugFromUrl(rawUrl);
    process.stdout.write(`\r[${i + 1}/${urls.length}] ${slug}   `);
    try {
      emptyProductImageDir(slug);
      await fetchOneWithPage(page, rawUrl);
      const urlsLocal = renameNumericToRoles(slug);
      if (!urlsLocal || urlsLocal.length === 0) {
        console.error(`\nНет числовых файлов после загрузки: ${slug}`);
        fail++;
        continue;
      }
      const obv = urlsLocal[0] || null;
      const rev = urlsLocal[1] || null;
      const pack = urlsLocal[2] || null;
      const box = urlsLocal[3] || null;
      for (const coinId of ids) {
        await conn.execute(
          `UPDATE coins SET image_obverse = ?, image_reverse = ?, image_packaging = ?, image_box = ?, image_urls = ? WHERE id = ?`,
          [obv, rev, pack, box, JSON.stringify(urlsLocal), coinId]
        );
      }
      patchDataJson(slug, urlsLocal, obv, rev, pack, box);
      ok++;
    } catch (e) {
      fail++;
      console.error(`\nFAIL ${rawUrl}:`, e && e.message ? e.message : e);
    }
  }
  await browser.close();
  await conn.end();
  console.log(`\nГотово. OK=${ok}, FAIL=${fail}. Далее: npm run data:export`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
