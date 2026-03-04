/**
 * Загружает страницу монеты Perth Mint, извлекает данные и картинки.
 * Сохраняет изображения в public/image/coins/foreign/, данные — в data/perth-mint-*.json.
 *
 * Паттерн URL картинок Perth Mint (по нему можно искать другие монеты):
 *   Базовый путь: https://www.perthmint.com/globalassets/assets/product-images-e-com-pages/coins/
 *   Полный путь: {BASE}/{YEAR}/{SKU}/{NN}-{описание-монеты}-{obv|rev|box|...}.jpg
 *   Пример: .../coins/2026/26y15aaa/02-deadly-dangerous-2026-giant-centipede-1oz-silver-proof-coin-rev.jpg
 *   SKU берётся со страницы товара (например 26Y15AAA → в URL 26y15aaa). Год — из пути.
 *   Без ?width=500 картинка отдаётся в полном разрешении (до 2000×2000).
 *
 * Чтобы найти другие монеты: нужны YEAR + SKU. Их можно взять из URL страницы товара или из разметки.
 * По одному SKU можно пробовать типовые имена: 01-*-obv.jpg, 02-*-rev.jpg (точное имя — из HTML страницы).
 *
 * Запуск: node scripts/fetch-perth-mint-coin.js [url]
 * По умолчанию: Giant Centipede 2026
 */
const fs = require("fs");
const path = require("path");

const DEFAULT_URL =
  "https://www.perthmint.com/shop/collector-coins/coins/deadly-and-dangerous-australias-giant-centipede-2026-1oz-silver-proof-coloured-coin/";

const FOREIGN_DIR = path.join(__dirname, "..", "public", "image", "coins", "foreign");
const DATA_DIR = path.join(__dirname, "..", "data");

async function main() {
  const url = process.argv[2] || DEFAULT_URL;
  console.log("Загрузка:", url);

  let chromium;
  let stealth;
  try {
    const playwrightExtra = require("playwright-extra");
    chromium = playwrightExtra.chromium;
    stealth = require("puppeteer-extra-plugin-stealth")();
    chromium.use(stealth);
  } catch (e) {
    console.error("Нужны: playwright, playwright-extra, puppeteer-extra-plugin-stealth");
    process.exit(1);
  }

  const browser = await chromium.launch({
    headless: process.env.HEADLESS !== "0",
    args: ["--disable-blink-features=AutomationControlled", "--no-sandbox"],
  });

  const context = await browser.newContext({
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    viewport: { width: 1280, height: 800 },
  });

  const page = await context.newPage();

  try {
    await page.goto(url, { waitUntil: "networkidle", timeout: 30000 });
    await page.waitForTimeout(2000);

    // Извлекаем данные со страницы
    const data = await page.evaluate(() => {
      const getText = (sel) => {
        const el = document.querySelector(sel);
        return el ? el.textContent.trim() : "";
      };
      const title = getText("h1") || getText("[data-product-name]") || document.title;
      const specRows = Array.from(document.querySelectorAll("table tr, .specifications dt, [class*='spec'] dd"));
      const specs = {};
      document.querySelectorAll("table tr").forEach((tr) => {
        const th = tr.querySelector("th, td:first-child");
        const td = tr.querySelector("td:last-child, td:nth-child(2)");
        if (th && td) {
          const key = th.textContent.replace(/\s+/g, " ").trim();
          const val = td.textContent.replace(/\s+/g, " ").trim();
          if (key && val) specs[key] = val;
        }
      });
      // Картинки: все img в области продукта / галереи
      const imgs = Array.from(
        document.querySelectorAll(
          "img[src*='perthmint'], img[src*='product'], .product-gallery img, [class*='gallery'] img, [class*='product'] img, main img, .product img"
        )
      )
        .map((img) => img.src || img.getAttribute("data-src") || img.getAttribute("data-srcset"))
        .filter(Boolean);
      // Уникальные URL, убираем миниатюры (thumb)
      const allImgUrls = Array.from(
        new Set(
          Array.from(document.querySelectorAll("img")).map((img) => img.src || img.getAttribute("data-src")).filter(Boolean)
        )
      ).filter((u) => !u.includes("logo") && !u.includes("icon") && (u.includes("product") || u.includes("coin") || u.includes("perthmint") || u.match(/\.(jpg|jpeg|png|webp)/i)));
      return { title, specs, imageUrls: allImgUrls.length ? allImgUrls : imgs };
    });

    if (!data.imageUrls || data.imageUrls.length === 0) {
      // Fallback: любые img в main
      const more = await page.evaluate(() => {
        return Array.from(document.querySelectorAll("main img, [role='main'] img, img[src]"))
          .map((i) => i.src)
          .filter((s) => s && !s.includes("logo") && !s.includes("icon") && (s.endsWith(".jpg") || s.endsWith(".png") || s.endsWith(".webp") || s.includes("image") || s.includes("media")));
      });
      data.imageUrls = [...(data.imageUrls || []), ...more].filter((u, i, a) => a.indexOf(u) === i);
    }

    console.log("Заголовок:", data.title || "(не найден)");
    console.log("Спеки:", JSON.stringify(data.specs, null, 2));
    console.log("Найдено изображений:", data.imageUrls.length);

    // Нормализуем спеки из известного формата страницы (Perth Mint)
    const mintageMatch = (data.specs["Maximum Mintage"] || data.specs["Mintage"] || "").replace(/\s/g, "");
    const yearMatch = (data.specs["Year"] || "").trim();
    const weightMatch = (data.specs["Minimum Gross Weight (g)"] || data.specs["Maximum Gross Weight (g)"] || "").replace(",", ".");
    const diameterMatch = (data.specs["Maximum Diameter (mm)"] || data.specs["Diameter (mm)"] || "").replace(",", ".");
    const thicknessMatch = (data.specs["Maximum Thickness (mm)"] || "").replace(",", ".");

    const coin = {
      title: data.title || "Deadly and Dangerous - Australia's Giant Centipede 2026 1oz Silver Proof Coloured Coin",
      title_ru: "Австралия — Гигантская сколопендра 2026, 1 oz серебро, пруф, цветная",
      country: "Австралия",
      series: "Deadly and Dangerous",
      face_value: "1 доллар (Тувалу)",
      release_date: yearMatch || "2026",
      mint: "The Perth Mint",
      mint_short: "Perth Mint",
      metal: "Серебро",
      metal_fineness: "99.99",
      mintage: mintageMatch ? parseInt(mintageMatch.replace(/\D/g, ""), 10) : 2500,
      weight_g: weightMatch ? parseFloat(weightMatch) : 31.107,
      weight_oz: 1,
      diameter_mm: diameterMatch ? parseFloat(diameterMatch) : 40.9,
      thickness_mm: thicknessMatch ? parseFloat(thicknessMatch) : 3.5,
      quality: "Proof, Coloured",
      catalog_number: "AU-PERTH-CENTIPEDE-2026",
      catalog_suffix: "26Y15AAA",
    };

    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    if (!fs.existsSync(FOREIGN_DIR)) fs.mkdirSync(FOREIGN_DIR, { recursive: true });

    const slug = "perth-centipede-2026";
    const jsonPath = path.join(DATA_DIR, `perth-mint-${slug}.json`);
    fs.writeFileSync(jsonPath, JSON.stringify({ coin, raw: data }, null, 2), "utf8");
    console.log("✓ Данные сохранены:", jsonPath);

    // Только изображения этой монеты (26y15aaa — centipede), приоритет: obverse, reverse
    const baseUrl = "https://www.perthmint.com";
    const productUrls = (data.imageUrls || [])
      .filter((u) => String(u).includes("26y15aaa") && (String(u).includes("obverse") || String(u).includes("rev") || String(u).includes("coin")))
      .map((u) => (u.startsWith("http") ? u : baseUrl + u))
      .map((u) => u.replace(/width=\d+/gi, "width=2000"))
      .filter((u, i, a) => a.indexOf(u) === i);
    // Порядок: obverse, затем reverse (по имени файла)
    const obvUrl = productUrls.find((u) => /obverse/i.test(u));
    const revUrl = productUrls.find((u) => /rev\.jpg|rev-left|02-deadly/i.test(u) && !/obverse/i.test(u)) || productUrls.find((u) => /rev/i.test(u));
    const toDownload = [obvUrl, revUrl].filter(Boolean);
    if (toDownload.length === 0) toDownload.push(...productUrls.slice(0, 2));

    const sharp = require("sharp");
    const MAX_SIDE = 1200;
    const WEBP_QUALITY = 88;
    const savedImages = [];

    for (let i = 0; i < toDownload.length; i++) {
      const imgUrl = toDownload[i];
      if (!imgUrl) continue;
      try {
        const res = await fetch(imgUrl, {
          headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36" },
          redirect: "follow",
        });
        if (!res.ok) {
          console.warn("  — HTTP", res.status, imgUrl.slice(0, 70) + "...");
          continue;
        }
        const buf = Buffer.from(await res.arrayBuffer());
        if (buf.length < 1000) continue;
        const baseName = i === 0 ? `${slug}-obv` : i === 1 ? `${slug}-rev` : `${slug}-${i}`;
        const webpPath = path.join(FOREIGN_DIR, `${baseName}.webp`);
        await sharp(buf)
          .resize(MAX_SIDE, MAX_SIDE, { fit: "inside", withoutEnlargement: true })
          .webp({ quality: WEBP_QUALITY })
          .toFile(webpPath);
        const relPath = "/image/coins/foreign/" + baseName + ".webp";
        savedImages.push(relPath);
        console.log("  ✓", baseName + ".webp");
      } catch (e) {
        console.warn("  —", imgUrl.slice(0, 60) + "...", e.message);
      }
    }

    if (savedImages.length > 0) {
      coin.image_obverse = savedImages[0] || null;
      coin.image_reverse = savedImages[1] || savedImages[0] || null;
      fs.writeFileSync(jsonPath, JSON.stringify({ coin, raw: data, savedImages }, null, 2), "utf8");
    }

    console.log("\nГотово. Данные:", jsonPath);
    console.log("Изображения в", FOREIGN_DIR);
  } finally {
    await browser.close();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
