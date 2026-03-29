/**
 * Дождаться окончания любого текущего mdp:fetch → циклы mdp:fetch:missing,
 * пока для всех URL листинга не появятся JSON → mdp:import → data:export:incremental.
 *
 *   node scripts/mdp-pipeline-to-site.js
 *   npm run mdp:publish-site
 *
 * Долгий прогон (часы). Удобно в фоне:
 *   nohup npm run mdp:publish-site >> data/mdp-pipeline-to-site.log 2>&1 &
 *
 * Env:
 *   MDP_PUBLISH_FETCH_ROUNDS — макс. проходов fetch:missing подряд (по умолчанию 15)
 *   MDP_PUBLISH_WAIT_MS — сколько ждать «чужой» fetch перед выходом (по умолчанию 172800000 = 48 ч)
 */
const fs = require("fs");
const path = require("path");
const { execSync, spawnSync } = require("child_process");
const { slugFromUrl, normalizeUrl } = require("./fetch-monnaie-de-paris-product.js");

const ROOT = path.join(__dirname, "..");
const DATA_DIR = path.join(ROOT, "data");
const LISTING = path.join(DATA_DIR, "monnaie-de-paris-listing-products.json");

function outPathForListingUrl(url) {
  const u = normalizeUrl(url);
  if (!u) return null;
  const slug = slugFromUrl(u);
  const safe = slug.replace(/[^a-z0-9_-]/gi, "_").slice(0, 120);
  return path.join(DATA_DIR, `monnaie-de-paris-${safe}.json`);
}

function countMissingFromListing() {
  if (!fs.existsSync(LISTING)) throw new Error("Нет " + LISTING);
  const items = JSON.parse(fs.readFileSync(LISTING, "utf8"));
  if (!Array.isArray(items)) throw new Error("Листинг не массив");
  let missing = 0;
  const samples = [];
  for (const row of items) {
    const fp = outPathForListingUrl(row.url);
    if (!fp || !fs.existsSync(fp)) {
      missing++;
      if (samples.length < 3) samples.push(row.url);
    }
  }
  return { total: items.length, missing, samples };
}

function fetchProcessRunning() {
  try {
    const o = execSync('pgrep -f "fetch-monnaie-de-paris-all.js" || true', { encoding: "utf8" }).trim();
    return Boolean(o);
  } catch {
    return false;
  }
}

function sleepSimple(sec) {
  try {
    execSync(`sleep ${sec}`);
  } catch {
    /* ignore */
  }
}

function main() {
  const maxRounds = Math.max(1, parseInt(process.env.MDP_PUBLISH_FETCH_ROUNDS || "15", 10) || 15);
  const maxWaitOther = Math.max(60_000, parseInt(process.env.MDP_PUBLISH_WAIT_MS || String(48 * 3600 * 1000), 10) || 48 * 3600 * 1000);

  process.chdir(ROOT);

  console.log("— MDP → сайт: старт —");
  const t0 = Date.now();
  if (fetchProcessRunning()) {
    console.log("Уже запущен fetch-monnaie-de-paris-all — ждём завершения (до", Math.round(maxWaitOther / 3600000), "ч)...");
    const deadline = Date.now() + maxWaitOther;
    while (fetchProcessRunning() && Date.now() < deadline) {
      sleepSimple(30);
      process.stdout.write(".");
    }
    console.log("");
    if (fetchProcessRunning()) {
      console.error("Таймаут ожидания чужого fetch. Остановите процесс вручную и запустите снова: npm run mdp:publish-site");
      process.exit(1);
    }
    console.log("Предыдущий fetch завершён, продолжаем.");
  }

  let round = 0;
  while (round < maxRounds) {
    const { total, missing, samples } = countMissingFromListing();
    console.log(`Листинг: ${total} URL, без JSON: ${missing}`);
    if (missing === 0) {
      console.log("Все карточки JSON на месте.");
      break;
    }
    round++;
    console.log(`— Раунд fetch:missing ${round}/${maxRounds} —`);
    const r = spawnSync("npm", ["run", "mdp:fetch:missing"], { stdio: "inherit", cwd: ROOT, shell: false });
    if (r.status !== 0) {
      console.error("mdp:fetch:missing завершился с кодом", r.status);
      process.exit(r.status || 1);
    }
    const after = countMissingFromListing().missing;
    console.log(`После раунда без JSON осталось: ${after}`);
    if (after === missing && after > 0) {
      console.warn("Прогресс не изменился — возможны постоянные ошибки. Примеры URL без файла:", samples.join(", "));
      break;
    }
  }

  const { total, missing } = countMissingFromListing();
  if (missing > 0) {
    console.error(`Стоп: без JSON ещё ${missing} из ${total}. Импорт и экспорт пропущены. Доработайте fetch и запустите снова.`);
    process.exit(1);
  }

  console.log("— mdp:import —");
  const im = spawnSync("npm", ["run", "mdp:import"], { stdio: "inherit", cwd: ROOT });
  if (im.status !== 0) {
    console.error("mdp:import завершился с кодом", im.status);
    process.exit(im.status || 1);
  }

  console.log("— data:export:incremental —");
  const ex = spawnSync("npm", ["run", "data:export:incremental"], { stdio: "inherit", cwd: ROOT });
  if (ex.status !== 0) {
    console.error("data:export:incremental завершился с кодом", ex.status);
    process.exit(ex.status || 1);
  }

  console.log("— Готово за", Math.round((Date.now() - t0) / 60000), "мин — монеты в public/data и картинки в foreign (после импорта).");
}

main();
