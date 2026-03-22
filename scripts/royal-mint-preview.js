/**
 * Один проход: спарсить PDP Royal Mint → положить в public/data/coins/<id>.json + id в coin-ids.json.
 * Локально: npm run dev → открыть напечатанный URL (по умолчанию /coins/991001/).
 *
 * Все аргументы передаются в fetch-royal-mint-coin-test.js, например:
 *   npm run royal-mint:preview -- --no-images "https://www.royalmint.com/..."
 *   ROYAL_MINT_LOCAL_ID=991002 npm run royal-mint:preview
 *
 * Когда всё ок — в прод: npm run royal-mint:import → npm run data:export → npm run build → git push → залить папку out/.
 */
const { spawnSync } = require("child_process");
const path = require("path");

const root = path.join(__dirname, "..");
const fetchScript = path.join(__dirname, "fetch-royal-mint-coin-test.js");
const forward = process.argv.slice(2);

const r = spawnSync(process.execPath, [fetchScript, ...forward], {
  cwd: root,
  encoding: "utf8",
  maxBuffer: 50 * 1024 * 1024,
});
if (r.stdout) process.stdout.write(r.stdout);
if (r.stderr) process.stderr.write(r.stderr);
if (r.status !== 0 && r.status != null) process.exit(r.status);

const m = (r.stdout || "").match(/__RM_JSON__\s+(.+)/);
if (!m) {
  console.error(
    "\nНе найден __RM_JSON__ (парсинг мог быть пропущен: graded slab / coin box — смотри сообщения выше)."
  );
  process.exit(1);
}

const jsonPath = m[1].trim();
const tsx = spawnSync(
  "npx",
  ["tsx", "scripts/royal-mint-to-public-catalog.ts", jsonPath],
  { cwd: root, stdio: "inherit", shell: true }
);
process.exit(tsx.status === null ? 1 : tsx.status);
