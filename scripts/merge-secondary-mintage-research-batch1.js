/**
 * Однократное слияние: заполняет proposals / verificationNotes / status
 * для первой исследовательской партии (не перезапускать поверх ручных правок без проверки).
 *
 *   node scripts/merge-secondary-mintage-research-batch1.js
 */
const fs = require("fs");
const path = require("path");

const QUEUE = path.join(__dirname, "..", "data", "secondary-mintage-research-queue.json");

const PATCHES = {
  4235: {
    proposals: [],
    verificationNotes:
      "Perth Mint / дилеры: для BU 50p Monopoly часто указывают безлимитный выпуск (NCLT, не для обращения); отдельного опубликованного числа тиража может не быть. Решите, нужен ли в каталоге только текст без числа.",
    status: "pending",
  },
  6018: {
    proposals: [
      {
        mintage: 4000,
        sourceName: "Britannia Coin Company",
        sourceUrl: "http://britanniacoincompany.com/buy-coins/silver-coins/2026-pooh-kindness-50-silver/",
      },
      {
        mintage: 4000,
        sourceName: "Crawley Coins",
        sourceUrl: "https://crawleycoins.co.uk/product/2026-winnie-the-pooh-01-kindness-50p-coloured-silver-proof/",
      },
      {
        mintage: 4000,
        sourceName: "Westminster Collection",
        sourceUrl: "https://www.westminstercollection.com/p-AAM4/The-UK-2026-100-Years-of-Winnie-the-Pooh-Kindness-Silver-Proof-50p-Coin.aspx",
      },
    ],
    verificationNotes:
      "Три независимых дилера — 4 000. В Numista на дату поиска отдельной карточки «Kindness 2026» не найдено.",
    status: "pending",
  },
  6019: {
    proposals: [
      {
        mintage: 1250,
        sourceName: "Britannia Coin Company",
        sourceUrl: "http://britanniacoincompany.com/buy-coins/silver-coins/2026-100-birthday-piedfort/",
      },
      {
        mintage: 1250,
        sourceName: "Chards",
        sourceUrl: "https://www.chards.co.uk/26-100th-Anniversary-Birth-Queen-Elizabeth-II-Silver-Proof/22827",
      },
    ],
    verificationNotes: "Пьефор £5; оба источника — 1 250.",
    status: "pending",
  },
  6023: {
    proposals: [
      {
        mintage: 2084,
        sourceName: "The Royal Mint (PDP: Silver Proof Piedfort Colour)",
        sourceUrl: "https://www.royalmint.com/shop/limited-editions/200-years-of-the-rnli/200-years-of-the-rnli-2024-50p-silver-proof-piedfort-colour-coin/",
      },
      {
        mintage: 1824,
        sourceName: "Coin Checker (Colour piedfort)",
        sourceUrl: "https://www.coinchecker.co.uk/50p-coins/2024-200-years-of-the-rnli-50p/",
      },
    ],
    verificationNotes:
      "РАСХОЖДЕНИЕ: RM PDP colour piedfort — 2 084; Coin Checker — limited edition 1 824 для colour piedfort. В вашей БД название без «Colour», source_url — Trial of the Pyx. Сверьте с фактической позицией и выберите число.",
    status: "needs_second_source",
  },
  6037: {
    proposals: [
      {
        mintage: 5810,
        sourceName: "The Royal Mint (Maximum Coin Mintage)",
        sourceUrl: "https://www.royalmint.com/britannia/commemorative/2025-britannia-1oz-silver-proof-coin/",
      },
      {
        mintage: 4500,
        sourceName: "Crawley Coins (Limited edition)",
        sourceUrl: "https://crawleycoins.co.uk/product/2025-britannia-1-oz-silver-proof/",
      },
      {
        mintage: 4500,
        sourceName: "Coin Parade (Limited edition)",
        sourceUrl: "https://coinparade.co.uk/2025-britannia-1oz-silver-proof/",
      },
    ],
    verificationNotes:
      "Две логики: «maximum coin mintage» 5 810 (RM) и limited edition продаж 4 500 (дилеры). Обычно в каталог записывают реальный лимит выпуска для продажи — выберите сами.",
    status: "pending",
  },
  6046: {
    proposals: [
      {
        mintage: 1500,
        sourceName: "Comm Coinage",
        sourceUrl: "https://www.commcoinage.com/2025-2-350-years-of-the-royal-observatory-greenwic",
      },
      {
        mintage: 1500,
        sourceName: "Crawley Coins",
        sourceUrl: "https://crawleycoins.co.uk/product/2025-royal-observatory-greenwich-2-silver-proof/",
      },
      {
        mintage: 1500,
        sourceName: "Britannia Coin Company",
        sourceUrl: "http://britanniacoincompany.com/buy-coins/silver-coins/2025-greenwich-silver/",
      },
    ],
    verificationNotes: "Silver proof £2 Greenwich; убедитесь, что не смешали с piedfort 650 (другой вариант).",
    status: "pending",
  },
  6653: {
    proposals: [
      {
        mintage: 999,
        sourceName: "AgAuNEWS (обзор Americana / GovMint)",
        sourceUrl: "https://agaunews.com/americana-uncle-sam-2oz-cast-silver-bar-2024-germania-mint-govmint/",
      },
      {
        mintage: 999,
        sourceName: "GovMint",
        sourceUrl: "https://www.govmint.com/germania-2oz-silver-americana-uncle-sam-cast-bar-ogp",
      },
    ],
    verificationNotes: "Cast bar 2 oz; при желании сверьте лимит на JM Bullion / BullionMax.",
    status: "pending",
  },
  6745: {
    proposals: [
      {
        mintage: 3600,
        sourceName: "Numista (Niue $3 2023 Roulette)",
        sourceUrl: "https://numista.com/354702",
      },
      {
        mintage: 3600,
        sourceName: "Infinity Coins",
        sourceUrl: "https://www.infinitycoins.com/Products/2023-niue-3--casino-spinning-roulette-wheel--15oz-silver.aspx",
      },
      {
        mintage: 3600,
        sourceName: "Powercoin",
        sourceUrl: "https://www.powercoin.it/en/oceania-south-pacific/7947-roulette-wheel-spinning-silver-coin-3-niue-2023.html",
      },
    ],
    verificationNotes: "Три источника сходятся на 3 600.",
    status: "pending",
  },
  6750: {
    proposals: [
      {
        mintage: 2500,
        sourceName: "Art in Coins",
        sourceUrl: "https://www.artincoins.com/product/2022-solomon-islands-1-ounce-animals-of-africa-black-rhino-shaped-silver-coin/",
      },
      {
        mintage: 2500,
        sourceName: "ModernCoinMart",
        sourceUrl:
          "https://moderncoinmart.com/product/2022-solomon-islands-animals-of-africa-series-black-rhino-shaped-1-oz-silver-reverse-proof-2-coin-ogp-sku69275/",
      },
    ],
    verificationNotes: "Solomon Islands 2022, серия Animals of Africa; оба дилера — 2 500.",
    status: "pending",
  },
};

function main() {
  const doc = JSON.parse(fs.readFileSync(QUEUE, "utf8"));
  const byId = Object.fromEntries(doc.items.map((x) => [x.coinId, x]));
  for (const [idStr, patch] of Object.entries(PATCHES)) {
    const id = parseInt(idStr, 10);
    const it = byId[id];
    if (!it) throw new Error("coinId не найден в очереди: " + id);
    if (it.proposals && it.proposals.length > 0) {
      console.warn("Пропуск coinId", id, "— proposals уже не пусты");
      continue;
    }
    Object.assign(it, patch);
  }
  doc.summary = doc.summary || {};
  doc.summary.researchBatch1At = new Date().toISOString();
  doc.summary.researchBatch1Ids = Object.keys(PATCHES).map((x) => parseInt(x, 10));
  doc.summary.researchBatch1Note =
    "Партия 1: заполнены proposals для 10 монет; проверьте и выставьте verified* + ready_for_db при согласии.";
  fs.writeFileSync(QUEUE, JSON.stringify(doc, null, 2), "utf8");
  console.log("OK:", QUEUE, "партия", doc.summary.researchBatch1Ids.length);
}

main();
