/**
 * Из сохранённого HTML (фрагмент страницы Royal Mint, например выдача Site Search 360 «silver»)
 * вытаскиваем ссылки на карточки товаров, переписываем /shop/ → invest bullion (как fetch-royal-mint-coin-test),
 * пишем список URL для очереди парсинга.
 *
 * 1) Вставь HTML в data/royal-mint-pasted-listing.html (или свой файл: --file).
 * 2) node scripts/extract-royal-mint-urls-from-html.js
 * 3) node scripts/fetch-royal-mint-seed-queue.js --file data/royal-mint-pasted-urls.txt
 *    (или npm run royal-mint:fetch-seed-queue -- --file data/royal-mint-pasted-urls.txt)
 * 4) npm run royal-mint:import && npm run data:export
 *
 * Переписывание /shop/ → invest: как в fetch-royal-mint-seed-queue.js — preferSilver, если в URL есть
 * «silver» или ss360Query=silver; иначе false (золотой PLP из HTML не ломаем).
 * Принудительно: --prefer-silver (все как silver) или --prefer-gold (все как gold).
 *
 * Ссылки /trial-of-the-pyx/ в список не попадают (архив Pyx не парсим).
 *
 * Флаги (как у листинга, по slug URL — если в ссылке нет «tube», фильтр не сработает):
 *   --keep-tube --keep-best-value --keep-graded-slab --keep-coin-box
 *   --append-main-list  — дописать в scripts/royal-mint-urls.txt
 *   --out path          — куда писать txt (по умолчанию data/royal-mint-pasted-urls.txt)
 */
const fs = require("fs");
const path = require("path");
const { extractRoyalMintUrlsFromHtmlFile } = require("./royal-mint-seed-url-io.js");
const { rewriteShopPdpToInvestBullion, isRoyalMintTrialOfPyxUrl } = require("./royal-mint-listing-collect.js");

const DEFAULT_HTML = path.join(__dirname, "..", "data", "royal-mint-pasted-listing.html");
const DEFAULT_OUT = path.join(__dirname, "..", "data", "royal-mint-pasted-urls.txt");
const MAIN_URL_LIST = path.join(__dirname, "royal-mint-urls.txt");

function isLikelyListingOrServiceUrl(absUrl) {
  try {
    const u = new URL(absUrl);
    const host = u.hostname.replace(/^www\./i, "").toLowerCase();
    if (host !== "royalmint.com") return true;
    const p = u.pathname.toLowerCase();
    if (p.includes("/search-results-page")) return true;
    if (/\/(cart|checkout|basket|my-account|login|register|sitecore|api)\b/i.test(p)) return true;
    const pathClean = u.pathname.replace(/\/$/, "");
    const parts = pathClean.split("/").filter(Boolean);
    const last = (parts[parts.length - 1] || "").toLowerCase();
    if (/^(gold|silver|platinum)-coins$/.test(last)) return true;
    if (/^\d+oz-[a-z0-9-]+-coins$/.test(last)) return true;
    if (last === "uk-coin-ranges" || last === "world-coins") return true;
    if (last === "bullion-coins" || last === "bullion") return true;
    return false;
  } catch {
    return true;
  }
}

function urlMatchesSkipFilters(url, opts) {
  const s = url.toLowerCase();
  if (opts.skipTube !== false && /tube/.test(s)) return true;
  if (opts.skipBestValue !== false && /best-value|best_value/.test(s)) return true;
  if (opts.skipCoinBox !== false && /coin-box|coin_box/.test(s)) return true;
  if (opts.skipGradedSlab !== false && /(\bngc\b|\bpcgs\b|graded-slab)/.test(s)) return true;
  return false;
}

function parseArgs() {
  const fi = process.argv.indexOf("--file");
  const oi = process.argv.indexOf("--out");
  return {
    htmlPath: fi >= 0 && process.argv[fi + 1] ? path.resolve(process.cwd(), process.argv[fi + 1]) : DEFAULT_HTML,
    outPath: oi >= 0 && process.argv[oi + 1] ? path.resolve(process.cwd(), process.argv[oi + 1]) : DEFAULT_OUT,
    preferGold: process.argv.includes("--prefer-gold"),
    preferSilver: process.argv.includes("--prefer-silver"),
    appendMain: process.argv.includes("--append-main-list"),
    keepTube: process.argv.includes("--keep-tube"),
    keepBestValue: process.argv.includes("--keep-best-value"),
    keepGradedSlab: process.argv.includes("--keep-graded-slab"),
    keepCoinBox: process.argv.includes("--keep-coin-box"),
  };
}

function main() {
  const args = parseArgs();
  const filterOpts = {
    skipTube: !args.keepTube,
    skipBestValue: !args.keepBestValue,
    skipGradedSlab: !args.keepGradedSlab,
    skipCoinBox: !args.keepCoinBox,
  };

  if (!fs.existsSync(args.htmlPath)) {
    console.error("Нет файла HTML:", args.htmlPath);
    console.error("Создай data/royal-mint-pasted-listing.html и вставь туда HTML со страницы Royal Mint.");
    process.exit(1);
  }

  const raw = extractRoyalMintUrlsFromHtmlFile(args.htmlPath);

  const seen = new Set();
  const finalUrls = [];
  for (const u of raw) {
    if (isLikelyListingOrServiceUrl(u)) continue;
    if (urlMatchesSkipFilters(u, filterOpts)) continue;
    let preferSilverRewrite;
    if (args.preferGold) preferSilverRewrite = false;
    else if (args.preferSilver) preferSilverRewrite = true;
    else preferSilverRewrite = /\bsilver\b|ss360query=silver/i.test(u);
    const rewritten = rewriteShopPdpToInvestBullion(u, { preferSilver: preferSilverRewrite });
    if (isRoyalMintTrialOfPyxUrl(u) || isRoyalMintTrialOfPyxUrl(rewritten)) continue;
    const norm = rewritten.split("#")[0].replace(/\/+$/, "");
    if (seen.has(norm)) continue;
    seen.add(norm);
    finalUrls.push(norm);
  }

  finalUrls.sort((a, b) => a.localeCompare(b));

  const outDir = path.dirname(args.outPath);
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

  const header =
    "# royal-mint: извлечено из HTML " +
    new Date().toISOString() +
    " — " +
    path.relative(process.cwd(), args.htmlPath) +
    (args.preferGold ? " (все --prefer-gold)" : args.preferSilver ? " (все --prefer-silver)" : " (preferSilver по URL, как seed-queue)") +
    "\n";
  fs.writeFileSync(args.outPath, header + finalUrls.join("\n") + (finalUrls.length ? "\n" : ""), "utf8");
  console.log("Источник HTML:", args.htmlPath);
  console.log("Найдено ссылок royalmint (до фильтра листингов):", raw.length);
  console.log("Итого URL товаров:", finalUrls.length);
  console.log("Записано:", args.outPath);

  if (args.appendMain && finalUrls.length > 0) {
    const existing = new Set();
    if (fs.existsSync(MAIN_URL_LIST)) {
      fs.readFileSync(MAIN_URL_LIST, "utf8")
        .split(/\r?\n/)
        .map((s) => s.trim())
        .filter((s) => s.startsWith("http"))
        .forEach((s) => existing.add(s));
    }
    const toAdd = finalUrls.filter((u) => !existing.has(u));
    if (toAdd.length === 0) {
      console.log("Все URL уже есть в", MAIN_URL_LIST);
    } else {
      const block = "\n# extract-royal-mint-urls-from-html.js " + new Date().toISOString() + "\n" + toAdd.join("\n") + "\n";
      fs.appendFileSync(MAIN_URL_LIST, block, "utf8");
      console.log("Дописано в", MAIN_URL_LIST, "новых:", toAdd.length);
    }
  }

  console.log("\nДальше (характеристики + картинки):");
  console.log("  node scripts/fetch-royal-mint-seed-queue.js --file \"" + args.outPath + "\"");
}

main();
