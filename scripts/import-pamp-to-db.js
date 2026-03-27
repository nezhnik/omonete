/**
 * Импорт PAMP collectibles (монеты и слитки) из data/pamp-collectible-*.json в coins.
 * Ключ обновления: source_url
 */
require("dotenv").config({ path: ".env" });
const mysql = require("mysql2/promise");
const fs = require("fs");
const path = require("path");
const sharp = require("sharp");
const { chromium } = require("playwright-extra");
const StealthPlugin = require("puppeteer-extra-plugin-stealth");
chromium.use(StealthPlugin());

const DATA_DIR = path.join(__dirname, "..", "data");
const FOREIGN_IMG_DIR = path.join(__dirname, "..", "public", "image", "coins", "foreign");
const { derivePampWeight } = require("../lib/pampWeightDerive");

function getConfig() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL не задан");
  const m = url.match(/mysql:\/\/([^:]+):([^@]+)@([^:]+):(\d+)\/(.+)/);
  if (!m) throw new Error("Неверный формат DATABASE_URL");
  const [, user, password, host, port, database] = m;
  return { host, port: Number(port), user, password, database };
}

function normalizeUrl(url) {
  if (!url || typeof url !== "string") return null;
  try {
    const u = new URL(url.trim());
    u.hash = "";
    u.search = "";
    return u.toString().replace(/\/+$/, "");
  } catch {
    return String(url).trim().replace(/\/+$/, "") || null;
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

function ensureDir(p) {
  if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
}

function sanitizeFilePart(v) {
  return String(v || "")
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 120);
}

function parseYearToDate(specs, title) {
  const src = `${specs.Year || ""} ${title || ""}`;
  const m = String(src).match(/\b(19|20)\d{2}\b/);
  return m ? `${m[0]}-01-01` : null;
}

function parseNumberLike(raw) {
  if (raw == null) return null;
  const s = String(raw).replace(",", ".").trim();
  const m = s.match(/(\d+(?:\.\d+)?)/);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : null;
}

function parseMintage(specs, title) {
  const specM = specs.Mintage != null ? String(specs.Mintage).trim() : "";
  if (specM) {
    const digits = specM.replace(/[^\d]/g, "");
    const n = digits ? Number(digits) : null;
    return { mintage: Number.isFinite(n) && n > 0 ? n : null, mintageDisplay: specM || null };
  }
  const t = String(title || "").trim();
  const fromDesc = t.match(/\blimited mintage of\s*([\d,.\s]+)\b/i);
  if (fromDesc) {
    const display = fromDesc[1].replace(/\s+/g, " ").trim();
    const digits = display.replace(/[^\d]/g, "");
    const n = digits ? Number(digits) : null;
    return { mintage: Number.isFinite(n) && n > 0 ? n : null, mintageDisplay: display || null };
  }
  const fromCoinsTitle = t.match(/\bmintage of (?:only\s+)?([\d,.\s]+)\s*coins?\b/i);
  if (fromCoinsTitle) {
    const display = fromCoinsTitle[1].replace(/\s+/g, " ").trim();
    const digits = display.replace(/[^\d]/g, "");
    const n = digits ? Number(digits) : null;
    return { mintage: Number.isFinite(n) && n > 0 ? n : null, mintageDisplay: display || null };
  }
  return { mintage: null, mintageDisplay: null };
}

function parsePurity(specs) {
  return specs.Purity ? String(specs.Purity).trim() : null;
}

function parseMetal(purity, title) {
  const p = String(purity || "").toUpperCase();
  const t = String(title || "").toLowerCase();
  if (p.includes("AU") || /\bgold\b|золот/i.test(t)) return "Золото";
  if (p.includes("AG") || /\bsilver\b|сереб/i.test(t)) return "Серебро";
  if (p.includes("CU") || /\bcopper\b|мед/i.test(t)) return "Медь";
  return null;
}

function parseDimensions(specs) {
  const raw = String(specs["Size (mm)."] || specs.Size || specs.Dimensions || "").replace(",", ".").trim();
  if (!raw) return { lengthMm: null, widthMm: null, diameterMm: null, thicknessMm: null };
  const size = raw.match(/(\d+(?:\.\d+)?)\s*[x×]\s*(\d+(?:\.\d+)?)/i);
  if (size) {
    return { lengthMm: size[1], widthMm: size[2], diameterMm: null, thicknessMm: parseNumberLike(specs.Thickness || "") };
  }
  return { lengthMm: null, widthMm: null, diameterMm: parseNumberLike(raw), thicknessMm: parseNumberLike(specs.Thickness || "") };
}

async function createPampDownloader() {
  const browser = await chromium.launch({ headless: process.env.HEADLESS !== "0", args: ["--no-sandbox"] });
  const context = await browser.newContext({
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    viewport: { width: 1366, height: 900 },
  });
  const page = await context.newPage();
  await page.goto("https://www.pamp.com/collections/collectibles", { waitUntil: "domcontentloaded", timeout: 90000 }).catch(() => {});
  await page.waitForTimeout(1200).catch(() => {});
  let currentProduct = null;
  return {
    async enterProduct(productUrl) {
      const normalized = normalizeUrl(productUrl);
      if (!normalized || normalized === currentProduct) return;
      await page.goto(normalized, { waitUntil: "domcontentloaded", timeout: 90000 }).catch(() => {});
      await page.waitForTimeout(500).catch(() => {});
      currentProduct = normalized;
    },
    async fetchBuffer(url) {
      try {
        const res = await context.request.get(url, {
          headers: {
            referer: currentProduct || "https://www.pamp.com/",
            accept: "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
          },
          timeout: 30000,
        });
        if (!res.ok()) throw new Error(`request status ${res.status()}`);
        const body = await res.body();
        return body && body.length > 0 ? body : null;
      } catch {
        try {
          const resp = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 });
          if (!resp || !resp.ok()) return null;
          const body = await resp.body();
          return body && body.length > 0 ? body : null;
        } catch {
          return null;
        }
      }
    },
    async close() {
      await browser.close().catch(() => {});
    },
  };
}

async function localizeForeignImage(url, fileBase, downloader) {
  if (!url || typeof url !== "string") return null;
  const raw = String(url).trim();
  if (!raw) return null;
  if (raw.startsWith("/image/coins/foreign/")) return raw;
  if (!/^https?:\/\//i.test(raw)) return null;
  ensureDir(FOREIGN_IMG_DIR);
  const safe = sanitizeFilePart(fileBase) || `pamp-${Date.now()}`;
  const fileName = `${safe}.webp`;
  const absOut = path.join(FOREIGN_IMG_DIR, fileName);
  const relOut = `/image/coins/foreign/${fileName}`;
  if (fs.existsSync(absOut) && fs.statSync(absOut).size > 0) return relOut;
  const buf = await downloader.fetchBuffer(raw);
  if (!buf || buf.length === 0) return null;
  try {
    await sharp(buf).webp({ quality: 90 }).toFile(absOut);
    return relOut;
  } catch {
    return null;
  }
}

async function main() {
  const arg = process.argv[2];
  let files = [];
  if (arg && arg.endsWith(".json")) {
    const p = path.isAbsolute(arg) ? arg : path.join(process.cwd(), arg);
    if (!fs.existsSync(p)) throw new Error(`Файл не найден: ${p}`);
    files = [p];
  } else {
    files = fs
      .readdirSync(DATA_DIR)
      .filter((f) => f.startsWith("pamp-collectible-") && f.endsWith(".json") && !f.includes("listing-products"))
      .map((f) => path.join(DATA_DIR, f))
      .sort();
  }
  if (!files.length) throw new Error("Нет файлов pamp-collectible-*.json");

  const conn = await mysql.createConnection(getConfig());

  const cols = [
    "title",
    "title_en",
    "series",
    "country",
    "face_value",
    "mint",
    "mint_short",
    "metal",
    "metal_fineness",
    "mintage",
    "mintage_display",
    "weight_g",
    "weight_oz",
    "release_date",
    "catalog_number",
    "catalog_suffix",
    "quality",
    "diameter_mm",
    "thickness_mm",
    "length_mm",
    "width_mm",
    "image_obverse",
    "image_reverse",
    "image_blister_obverse",
    "image_blister_reverse",
    "image_packaging",
    "image_box",
    "image_certificate",
    "source_url",
  ];
  const updateCols = cols.filter((k) => k !== "catalog_number");
  const setClause = updateCols.map((k) => `${k} = ?`).join(", ");

  const downloader = await createPampDownloader();
  let inserted = 0;
  let updated = 0;
  try {
  for (const filePath of files) {
    let raw;
    try {
      raw = JSON.parse(fs.readFileSync(filePath, "utf8"));
    } catch {
      continue;
    }
    const sourceUrl = normalizeUrl(raw.source_url);
    if (!sourceUrl || !/pamp\.com/i.test(sourceUrl)) continue;
    await downloader.enterProduct(sourceUrl);
    const slug = slugFromUrl(sourceUrl);
    const specs = raw.specs || {};
    const title = String(raw.title || "").trim() || slug;
    const purity = parsePurity(specs);
    const metal = parseMetal(purity, title);
    const { mintage, mintageDisplay } = parseMintage(specs, title);
    const { weightG, weightOz } = derivePampWeight(specs, title);
    const releaseDate = parseYearToDate(specs, title);
    const faceValue = specs.Denomination ? String(specs.Denomination).trim() : "—";
    const series = specs.Series ? String(specs.Series).trim() : "PAMP Collectibles";
    const quality = specs.Grade ? String(specs.Grade).trim() : null;
    const { lengthMm, widthMm, diameterMm, thicknessMm } = parseDimensions(specs);
    const classified = raw.classified || {};

    const imageObverse = await localizeForeignImage(classified.obverse, `${slug}-obv`, downloader);
    const imageReverse = await localizeForeignImage(classified.reverse, `${slug}-rev`, downloader);
    const imageBlisterObv = await localizeForeignImage(classified.blister_obverse, `${slug}-blister-obv`, downloader);
    const imageBlisterRev = await localizeForeignImage(classified.blister_reverse, `${slug}-blister-rev`, downloader);
    // Если есть полная блистер-пара, packaging дублирует смысл и не нужен.
    const imagePackaging = (imageBlisterObv && imageBlisterRev)
      ? null
      : await localizeForeignImage(classified.packaging, `${slug}-packaging`, downloader);
    const imageBox = await localizeForeignImage(classified.box, `${slug}-box`, downloader);
    const imageCertificate = await localizeForeignImage(classified.certificate, `${slug}-certificate`, downloader);

    const catalogNumber = `CH-PAMP-${slug}`.toUpperCase().slice(0, 64);
    const values = [
      title,
      title,
      series,
      "Швейцария",
      faceValue,
      "PAMP",
      "PAMP",
      metal,
      purity,
      mintage,
      mintageDisplay,
      weightG,
      weightOz,
      releaseDate,
      catalogNumber,
      slug,
      quality,
      diameterMm,
      thicknessMm,
      lengthMm,
      widthMm,
      imageObverse,
      imageReverse,
      imageBlisterObv,
      imageBlisterRev,
      imagePackaging,
      imageBox,
      imageCertificate,
      sourceUrl,
    ];

    const [rows] = await conn.execute("SELECT id FROM coins WHERE source_url = ? LIMIT 1", [sourceUrl]);
    if (rows.length > 0) {
      const catalogIdx = cols.indexOf("catalog_number");
      const updateValues = [...values.slice(0, catalogIdx), ...values.slice(catalogIdx + 1), rows[0].id];
      await conn.execute(`UPDATE coins SET ${setClause} WHERE id = ?`, updateValues);
      updated++;
    } else {
      const placeholders = cols.map(() => "?").join(", ");
      await conn.execute(`INSERT INTO coins (${cols.join(", ")}) VALUES (${placeholders})`, values);
      inserted++;
    }
  }
  } finally {
    await downloader.close();
  }

  await conn.end();
  console.log(`✓ PAMP: добавлено ${inserted}, обновлено ${updated}`);
  console.log("Дальше: npm run data:export");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

