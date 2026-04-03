/**
 * Список монет из экспортируемого каталога, у которых ещё нет нормального тиража
 * (то же правило, что mintage_needs_research в public/data/coins.json после export).
 *
 * Пишет:
 *   reports/mintage-export-gap-research.json
 *   reports/mintage-export-gap-research.md  — таблица для ручного поиска + пустые колонки под источники
 *
 *   node scripts/generate-mintage-export-gap-research.js
 */
require("dotenv").config({ path: ".env" });
const fs = require("fs");
const path = require("path");
const mysql = require("mysql2/promise");
const { coinNeedsMintageResearch } = require("./parsing-mintage-constants.js");

const ROOT = path.join(__dirname, "..");
const JSON_OUT = path.join(ROOT, "reports", "mintage-export-gap-research.json");
const MD_OUT = path.join(ROOT, "reports", "mintage-export-gap-research.md");

const EXCLUDED_EXPORT_COIN_IDS = new Set(["5998", "6000", "6012"]);

function getConfig() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL не задан");
  const m = url.match(/mysql:\/\/([^:]+):([^@]+)@([^:]+):(\d+)\/(.+)/);
  if (!m) throw new Error("Неверный формат DATABASE_URL");
  const [, user, password, host, port, database] = m;
  return { host, port: Number(port), user, password, database };
}

function rowKeptInExportCatalog(r) {
  if (EXCLUDED_EXPORT_COIN_IDS.has(String(r.id))) return false;
  const hasNumericMintage = r.mintage != null && Number(r.mintage) !== 0;
  const country = (r.country || "").trim();
  const hasDisplay = r.mintage_display != null && String(r.mintage_display).trim() !== "";
  const isForeignUnlimited = country && !/^Россия/i.test(country) && hasDisplay;
  const isRoyalMintCatalog = /^GB-ROYAL-/i.test(String(r.catalog_number || "").trim());
  const isPampCollectible = /^CH-PAMP-/i.test(String(r.catalog_number || "").trim());
  const isMennicaGoldBar = /^PL-MENNICA-GOLD-BAR-/i.test(String(r.catalog_number || "").trim());
  return (
    hasNumericMintage || isForeignUnlimited || isRoyalMintCatalog || isPampCollectible || isMennicaGoldBar
  );
}

function escMdCell(s) {
  return String(s ?? "")
    .replace(/\|/g, "\\|")
    .replace(/\r?\n/g, " ")
    .trim();
}

async function main() {
  const conn = await mysql.createConnection(getConfig());
  let rows;
  try {
    const [r] = await conn.execute(
      `SELECT id, title, title_en, series, country, face_value, mint, mint_short, catalog_number, catalog_suffix, source_url, mintage, mintage_display
       FROM coins ORDER BY id`
    );
    rows = r;
  } catch (e) {
    if (/title_en/.test(String(e.message))) {
      const [r] = await conn.execute(
        `SELECT id, title, series, country, face_value, mint, mint_short, catalog_number, catalog_suffix, source_url, mintage, mintage_display
         FROM coins ORDER BY id`
      );
      rows = r.map((x) => ({ ...x, title_en: null }));
    } else throw e;
  }
  await conn.end();

  const exported = rows.filter(rowKeptInExportCatalog);
  const gap = exported.filter((r) => coinNeedsMintageResearch(r));

  const byMint = {};
  for (const r of gap) {
    const m = String(r.mint || r.mint_short || "—").trim() || "—";
    byMint[m] = (byMint[m] || 0) + 1;
  }
  const byMintSorted = Object.entries(byMint).sort((a, b) => b[1] - a[1]);

  const items = gap.map((r) => ({
    id: String(r.id),
    title: r.title ?? null,
    title_en: r.title_en ?? null,
    series: r.series ?? null,
    country: r.country ?? null,
    face_value: r.face_value ?? null,
    mint: r.mint ?? null,
    mint_short: r.mint_short ?? null,
    catalog_number: r.catalog_number ?? null,
    catalog_suffix: r.catalog_suffix ?? null,
    source_url: r.source_url != null ? String(r.source_url).trim() || null : null,
    mintage_db: r.mintage ?? null,
    mintage_display_db: r.mintage_display ?? null,
  }));

  const doc = {
    generated_at: new Date().toISOString(),
    definition:
      "Монеты, которые попадают в выгрузку каталога (как export-coins-to-json.js), но coinNeedsMintageResearch === true — на сайте показывается как без нормального тиража.",
    total: items.length,
    by_mint: Object.fromEntries(byMintSorted),
    items,
  };

  fs.writeFileSync(JSON_OUT, JSON.stringify(doc, null, 2), "utf8");

  const lines = [];
  lines.push("# Mintage export gap — очередь на поиск тиража");
  lines.push("");
  lines.push(`Сгенерировано: ${doc.generated_at}`);
  lines.push("");
  lines.push("## Что это");
  lines.push("");
  lines.push(
    "Те же монеты, что учитываются в строке `[тираж] экспорт каталога: без числового тиража / «Тираж не указан»` при `npm run data:export`. Здесь **отдельный** список от когорты missing-from-4555 (394 id)."
  );
  lines.push("");
  lines.push(`**Всего позиций: ${items.length}**`);
  lines.push("");
  lines.push("## Сводка по монетным двором");
  lines.push("");
  for (const [mint, n] of byMintSorted) {
    lines.push(`- ${mint}: ${n}`);
  }
  lines.push("");
  lines.push("## Остаток без тиража после автопарсера");
  lines.push("");
  lines.push(
    "После прогона `npm run coins:fetch-mintage-export-gap:apply` скрипт `fetch-mintage-export-gap-from-official.js` уже обходит **таблицу спецификаций** и **блок product-overview** на Royal Mint (`p.sub-title`, `h2.h3`, колонки), по остальным `source_url` — эвристики по HTML. Если для позиции тираж **всё равно не найден** (в отчёте `mintage-export-gap-fetch-report.json` — `not_found_on_page` / запись по-прежнему в этой очереди после экспорта), принимаем рабочую гипотезу: **на указанной официальной странице числового тиража в открытом виде нет** (не опубликован или тип страницы не содержит эти данные). Дальше — другой источник вручную (**Source A**), либо статус `no_mintage_source`, если подтверждаете отсутствие цифры."
  );
  lines.push("");
  lines.push("## Royal Mint: вторичные источники (без записи в БД)");
  lines.push("");
  lines.push(
    "Для монет Royal Mint из кэша «на PDP тиража нет» (`reports/mintage-export-gap-no-mintage-cache-rm.json`) можно собрать **кандидаты** с дилерских сайтов **без поисковиков** (встроенный поиск сайтов), скрипт `scripts/royal-mint-external-mintage-research.js`."
  );
  lines.push("");
  lines.push(
    "- Запуск (пример): `node scripts/royal-mint-external-mintage-research.js --direct-sites --concurrency 1 --max-links 8 --checkpoint-every 5 --out-timestamp`"
  );
  lines.push(
    "- Результат: `reports/royal-mint-external-mintage-research.<timestamp>.json` — у каждой монеты `proposals` (URL, цитата с *limited edition* / *edition limit* / *mintage* и т.п.). Поле `verifiedMintage` ставится только если **одна и та же цифра** встречается на **два разных домена**; иначе `needs_second_source` — нужен ручной выбор или второй источник."
  );
  lines.push(
    "- В **БД скрипт не пишет**; после вашей проверки тираж заносится отдельно (как и для колонок таблицы ниже)."
  );
  lines.push("");
  lines.push("## Таблица для работы");
  lines.push("");
  lines.push(
    "Заполняйте: **Source A** (ссылка), **mintage_candidate** (число или пояснение), **status** (`pending` / `verified` / `no_mintage_source`). Строки, оставшиеся здесь после автопарсера, — кандидаты на ручной поиск, см. раздел выше. После согласования — обновление БД (отдельный скрипт или SQL)."
  );
  lines.push("");
  lines.push(
    "| id | title | country | mint | catalog_number | source_url | Source A | mintage_candidate | status | notes |"
  );
  lines.push("|---|---|---|---|---|---|---|---|---|---|");

  const mintOrder = new Map(byMintSorted.map(([m], i) => [m, i]));
  const sortedForMd = [...items].sort((a, b) => {
    const ma = String(a.mint || a.mint_short || "—").trim() || "—";
    const mb = String(b.mint || b.mint_short || "—").trim() || "—";
    const oa = mintOrder.has(ma) ? mintOrder.get(ma) : 9999;
    const ob = mintOrder.has(mb) ? mintOrder.get(mb) : 9999;
    if (oa !== ob) return oa - ob;
    return Number(a.id) - Number(b.id);
  });

  let lastMint = null;
  for (const r of sortedForMd) {
    const mintLabel = String(r.mint || r.mint_short || "—").trim() || "—";
    if (mintLabel !== lastMint) {
      lastMint = mintLabel;
      lines.push(`| **${escMdCell(mintLabel)}** |  |  |  |  |  |  |  |  |  |`);
    }
    lines.push(
      `| ${escMdCell(r.id)} | ${escMdCell(r.title)} | ${escMdCell(r.country)} | ${escMdCell(r.mint || r.mint_short)} | ${escMdCell(r.catalog_number)} | ${escMdCell(r.source_url)} |  |  | pending |  |`
    );
  }

  lines.push("");
  fs.writeFileSync(MD_OUT, lines.join("\n"), "utf8");

  console.log(JSON.stringify({ total: items.length, json: JSON_OUT, md: MD_OUT }, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
