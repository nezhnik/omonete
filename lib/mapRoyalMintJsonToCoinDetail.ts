import type { CoinDetailData, CoinSeriesItem } from "../components/CoinDetail";

type RoyalMintExportFile = {
  coin?: Record<string, unknown>;
  raw?: {
    classified?: {
      obverse?: string | null;
      reverse?: string | null;
      blister_obverse?: string | null;
      blister_reverse?: string | null;
      box?: string | null;
      certificate?: string | null;
    };
  };
  saved?: Record<string, unknown>;
};

function metalCodeFromRu(metal: string | undefined): string | undefined {
  const s = String(metal || "").toLowerCase();
  if (/серебр|silver/.test(s)) return "Ag";
  if (/золот|gold/.test(s)) return "Au";
  if (/платин|platinum/.test(s)) return "Pt";
  if (/паллад|palladium/.test(s)) return "Pd";
  return undefined;
}

function metalColorFromCode(code: string | undefined): string | undefined {
  if (code === "Au") return "#FFD700";
  if (code === "Ag") return "#C0C0C0";
  if (code === "Pt") return "#E5E4E2";
  if (code === "Pd") return "#CED0DD";
  return undefined;
}

/**
 * Преобразует JSON из fetch-royal-mint-coin-test.js в формат страницы /coins/[id].
 */
export function mapRoyalMintJsonToCoinDetail(data: RoyalMintExportFile): {
  coin: CoinDetailData;
  sameSeries: CoinSeriesItem[];
} | null {
  const c = data.coin;
  if (!c || typeof c.title !== "string") return null;

  const classified = data.raw?.classified || {};
  const saved = data.saved || {};

  const localObv = typeof c.image_obverse === "string" ? c.image_obverse : null;
  const localRev = typeof c.image_reverse === "string" ? c.image_reverse : null;
  const urlObv = classified.obverse || null;
  const urlRev = classified.reverse || null;
  const obv = localObv || urlObv || null;
  const rev = localRev || urlRev || null;

  /** Если локальных webp нет — картинки с CDN Royal Mint (как в raw.classified). */
  const PLACEHOLDER = "https://www.royalmint.com/globalassets/__rebrand/_common/trm-logo-225.png";
  const mainImg = obv || rev || PLACEHOLDER;

  const extras: { url: string; role: string }[] = [];
  const pushExtra = (url: string | null | undefined, role: string) => {
    if (!url || url === mainImg) return;
    if (extras.some((e) => e.url === url)) return;
    extras.push({ url, role });
  };

  pushExtra(rev, "reverse");
  pushExtra(obv, "obverse");
  pushExtra(classified.blister_obverse || null, "blister_obverse");
  pushExtra(classified.blister_reverse || null, "blister_reverse");
  pushExtra(classified.box || (typeof saved.box === "string" ? saved.box : null), "box");
  pushExtra(
    classified.certificate || (typeof saved.certificate === "string" ? saved.certificate : null),
    "certificate"
  );

  const release = typeof c.release_date === "string" ? c.release_date : "";
  const yearNum = release ? parseInt(release.slice(0, 4), 10) : NaN;
  const year = Number.isFinite(yearNum) ? yearNum : new Date().getFullYear();

  const metalStr = typeof c.metal === "string" ? c.metal : "";
  const metalCode = metalCodeFromRu(metalStr);

  const coin: CoinDetailData = {
    /** Перезаписывается скриптом royal-mint-to-public-catalog.ts под id файла в public/data/coins/ */
    id: "0",
    title: c.title,
    seriesName: typeof c.series === "string" ? c.series : undefined,
    imageUrl: mainImg,
    imageUrls: extras.map((e) => e.url),
    imageUrlRoles: extras.map((e) => e.role) as CoinDetailData["imageUrlRoles"],
    inCollection: false,
    mintName: typeof c.mint === "string" ? c.mint : "The Royal Mint",
    mintShort: typeof c.mint_short === "string" ? c.mint_short : undefined,
    mintCountry: typeof c.country === "string" ? c.country : "Великобритания",
    year,
    faceValue: typeof c.face_value === "string" ? c.face_value : "",
    metal: metalStr || "—",
    metalCode,
    metalColor: metalColorFromCode(metalCode),
    metalCodes: metalCode ? [metalCode] : undefined,
    quality: typeof c.quality === "string" ? c.quality : undefined,
    mintage: typeof c.mintage === "number" ? c.mintage : undefined,
    mintageDisplay: typeof c.mintage_display === "string" ? c.mintage_display : undefined,
    weightG: c.weight_g != null ? String(c.weight_g) : undefined,
    weightOz: typeof c.weight_oz === "string" ? c.weight_oz : undefined,
    purity: c.metal_fineness != null ? String(c.metal_fineness) : undefined,
    diameterMm: c.diameter_mm != null ? String(c.diameter_mm) : undefined,
    thicknessMm: c.thickness_mm != null ? String(c.thickness_mm) : undefined,
    lengthMm: c.length_mm != null ? String(c.length_mm) : undefined,
    widthMm: c.width_mm != null ? String(c.width_mm) : undefined,
    rectangular: Boolean(c.rectangular),
  };

  return { coin, sameSeries: [] };
}
