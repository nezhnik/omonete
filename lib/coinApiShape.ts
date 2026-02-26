/**
 * Формирование ответа API монет в том же формате, что и статические JSON.
 * Используется в /api/coins и /api/coins/[id]. Логика совпадает с scripts/export-coins-to-json.js.
 */
import { getConnection } from "./db";
import fs from "fs";
import path from "path";

const PLACEHOLDER = "/image/coin-placeholder.svg";

type Row = Record<string, unknown>;

function obverseUrl(imageObverse: unknown): string | null {
  if (imageObverse && String(imageObverse).trim()) return String(imageObverse).trim();
  return null;
}
function reverseUrl(imageReverse: unknown): string | null {
  if (imageReverse && String(imageReverse).trim()) return String(imageReverse).trim();
  return null;
}
function firstImageUrl(imageUrls: unknown, _catalogNumber: unknown, imageObverse: unknown): string | null {
  if (imageObverse && String(imageObverse).trim()) return String(imageObverse).trim();
  if (Array.isArray(imageUrls) && imageUrls[0]) return String(imageUrls[0]);
  return null;
}

function cleanTitle(s: unknown): string {
  if (s == null || typeof s !== "string") return "";
  return s
    .replace(/<nobr>/gi, "")
    .replace(/<\/nobr>/gi, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function yearFromCatalogSuffix(suffix: unknown): number | null {
  if (suffix == null || String(suffix).length !== 2) return null;
  const yy = parseInt(String(suffix), 10);
  if (Number.isNaN(yy) || yy < 0 || yy > 99) return null;
  return 2000 + yy;
}

function metalOnly(str: unknown): string {
  if (!str || typeof str !== "string") return "—";
  const cleaned = String(str).replace(/\s*\d{3,4}(\/\d{3,4})?\s*/g, "").trim();
  if (!cleaned) return "—";
  return cleaned.charAt(0).toUpperCase() + cleaned.slice(1).toLowerCase();
}

const METAL_CODE_MAP: { pattern: RegExp; code: string; color: string }[] = [
  { pattern: /золото/i, code: "Au", color: "#FFD700" },
  { pattern: /платина/i, code: "Pt", color: "#E5E4E2" },
  { pattern: /палладий/i, code: "Pd", color: "#CEC5B4" },
  { pattern: /серебро/i, code: "Ag", color: "#C0C0C0" },
  { pattern: /медь/i, code: "Cu", color: "#97564A" },
];

function getMetalCodeAndColor(metalStr: unknown): { code: string | null; color: string | null } {
  if (!metalStr || typeof metalStr !== "string") return { code: null, color: null };
  const m = String(metalStr).toLowerCase().trim();
  for (const { pattern, code, color } of METAL_CODE_MAP) {
    if (pattern.test(m)) return { code, color };
  }
  return { code: null, color: null };
}

function getMetalCodes(metalStr: unknown): string[] {
  if (!metalStr || typeof metalStr !== "string") return [];
  const m = String(metalStr).toLowerCase().trim();
  if (/золото/i.test(m) && /серебро/i.test(m)) return ["Au", "Ag"];
  const { code } = getMetalCodeAndColor(metalStr);
  return code ? [code] : [];
}

const WEIGHT_OZ_TO_LABEL: Record<string, string> = {
  "5 кг": "5 кг · 5000 грамм",
  "3 кг": "3 кг · 3000 грамм",
  "1 кг": "1 кг · 1000 грамм",
  "10 унций": "10 унций · 311 г",
  "5 унций": "5 унций · 155,5 г",
  "3 унции": "3 унции · 93,3 г",
  "2 унции": "2 унции · 62,2 г",
  "1 унция": "1 унция · 31,1 грамм",
  "1/2 унции": "1/2 унции · 15,55 грамм",
  "1/4 унции": "1/4 унции · 7,78 грамм",
  "1/8 унции": "1/8 унции · 3,89 грамм",
  "1/10 унции": "1/10 унции · 3,11 грамм",
  "1/25 унции": "1/25 унции · 1,24 грамм",
  "1/100 унции": "1/100 унции · 0,31 грамм",
  "1/200 унции": "1/200 унции · 0,156 грамм",
  "1/1000 унции": "1/1000 унции · 0,031 грамм",
};

function parseWeightG(weightG: unknown): number | null {
  if (weightG == null || weightG === "") return null;
  const s = String(weightG).trim().replace(",", ".");
  const match = s.match(/^\s*(\d+(?:\.\d+)?)/);
  if (!match) return null;
  const g = parseFloat(match[1]);
  return Number.isNaN(g) ? null : g;
}

const WEIGHT_LABELS = [
  { g: 5000, label: "5 кг · 5000 грамм", tol: 20 },
  { g: 3000, label: "3 кг · 3000 грамм", tol: 15 },
  { g: 1000, label: "1 кг · 1000 грамм", tol: 5 },
  { g: 311.03, label: "10 унций · 311 г", tol: 2 },
  { g: 155.52, label: "5 унций · 155,5 г", tol: 1.5 },
  { g: 93.31, label: "3 унции · 93,3 г", tol: 1 },
  { g: 62.21, label: "2 унции · 62,2 г", tol: 1 },
  { g: 31.1, label: "1 унция · 31,1 грамм", tol: 0.2 },
  { g: 15.55, label: "1/2 унции · 15,55 грамм", tol: 0.2 },
  { g: 7.78, label: "1/4 унции · 7,78 грамм", tol: 0.2 },
  { g: 3.89, label: "1/8 унции · 3,89 грамм", tol: 0.2 },
  { g: 3.11, label: "1/10 унции · 3,11 грамм", tol: 0.2 },
  { g: 1.24, label: "1/25 унции · 1,24 грамм", tol: 0.05 },
  { g: 0.31, label: "1/100 унции · 0,31 грамм", tol: 0.02 },
  { g: 0.156, label: "1/200 унции · 0,156 грамм", tol: 0.01 },
  { g: 0.031, label: "1/1000 унции · 0,031 грамм", tol: 0.005 },
];

function getWeightLabel(weightG: unknown, weightOz: unknown): string | null {
  const oz = weightOz && String(weightOz).trim();
  if (typeof oz === "string" && oz in WEIGHT_OZ_TO_LABEL) return WEIGHT_OZ_TO_LABEL[oz as keyof typeof WEIGHT_OZ_TO_LABEL];
  const g = parseWeightG(weightG);
  if (g == null) return null;
  for (const { g: ref, label, tol = 0.2 } of WEIGHT_LABELS) {
    if (Math.abs(g - ref) <= tol) return label;
  }
  return null;
}

function hasImage(r: Row): boolean {
  const ob = r.image_obverse && String(r.image_obverse).trim();
  const rev = r.image_reverse && String(r.image_reverse).trim();
  return !!(ob && rev);
}

function getFirstImageSide(): "obverse" | "reverse" {
  try {
    const p = path.join(process.cwd(), "coin-display-config.json");
    const data = JSON.parse(fs.readFileSync(p, "utf8")) as { firstImage?: string };
    return data.firstImage === "reverse" ? "reverse" : "obverse";
  } catch {
    return "obverse";
  }
}

function getRectangularBases(): string[] {
  try {
    const p = path.join(process.cwd(), "rectangular-coins.json");
    const arr = JSON.parse(fs.readFileSync(p, "utf8")) as unknown;
    return Array.isArray(arr) ? arr.map((x) => String(x).trim()).filter(Boolean) : [];
  } catch {
    return [];
  }
}

function isRectangular(catalogNumber: unknown, bases: string[]): boolean {
  if (!catalogNumber || bases.length === 0) return false;
  const cat = String(catalogNumber).trim();
  return bases.some((base) => cat === base || cat.startsWith(base + "-"));
}

export type ListCoin = {
  id: string;
  title: string;
  country?: string;
  year: number;
  faceValue?: string;
  imageUrl: string;
  imageUrls?: string[];
  seriesName?: string;
  metalCode?: string;
  metalCodes?: string[];
  metalLabel?: string;
  mintName?: string;
  mintShort?: string;
  mintLogoUrl?: string;
  weightLabel?: string;
  weightG?: number;
  rectangular?: boolean;
};

export type DetailCoin = {
  id: string;
  title: string;
  seriesName?: string;
  imageUrl: string;
  imageUrls?: string[];
  inCollection: boolean;
  mintName: string;
  mintShort?: string;
  mintCountry: string;
  year: number | null;
  faceValue: string;
  metal: string;
  metalCode?: string;
  metalColor?: string;
  metalCodes?: string[];
  mintage?: string | number;
  mintageDisplay?: string;
  weightG?: string;
  weightOz?: string;
  purity?: string;
  quality?: string;
  diameterMm?: string | number;
  thicknessMm?: string | number;
  lengthMm?: string | number;
  widthMm?: string | number;
  catalogSuffix?: string;
  rectangular?: boolean;
  mintLogoUrl?: string;
};

export type SameSeriesItem = {
  id: string;
  title: string;
  seriesName?: string;
  faceValue: string;
  imageUrl: string;
  metalCode?: string;
  metalColor?: string;
  metalCodes?: string[];
  metalName?: string;
  weightG?: string;
  rectangular?: boolean;
};

function buildImageUrls(
  r: Row,
  firstImageSide: "obverse" | "reverse"
): { imageUrl: string; imageUrls: string[] } {
  const obverse = obverseUrl(r.image_obverse);
  const reverse = reverseUrl(r.image_reverse);
  const imageUrls = r.image_urls as string[] | undefined;
  const imageBox = r.image_box && String(r.image_box).trim();
  const imageCertificate = r.image_certificate && String(r.image_certificate).trim();
  const firstImage = firstImageSide === "reverse" ? (reverse ?? obverse ?? "") : (obverse ?? reverse ?? "");
  const imageUrlsOut: string[] = [];
  if (firstImageSide === "reverse") {
    if (reverse) imageUrlsOut.push(reverse);
    if (obverse) imageUrlsOut.push(obverse);
  } else {
    if (obverse) imageUrlsOut.push(obverse);
    if (reverse) imageUrlsOut.push(reverse);
  }
  if (imageBox) imageUrlsOut.push(String(imageBox));
  if (imageCertificate) imageUrlsOut.push(String(imageCertificate));
  if (imageUrlsOut.length === 0 && Array.isArray(imageUrls) && imageUrls.length > 0) imageUrlsOut.push(...(imageUrls as string[]));
  const imageUrl = firstImage || PLACEHOLDER;
  return { imageUrl, imageUrls: imageUrlsOut };
}

function rowToListCoin(
  r: Row,
  mintLogoMap: Map<string, string>,
  firstImageSide: "obverse" | "reverse",
  rectangularBases: string[]
): ListCoin {
  const releaseDate = r.release_date as string | null;
  const year = yearFromCatalogSuffix(r.catalog_suffix) ?? (releaseDate ? new Date(releaseDate).getFullYear() : 0);
  const { imageUrl, imageUrls: imageUrlsOut } = buildImageUrls(r, firstImageSide);
  const metalCode = getMetalCodeAndColor(r.metal).code;
  const metalCodes = getMetalCodes(r.metal);
  const weightLabel = getWeightLabel(r.weight_g, r.weight_oz);
  const weightG = parseWeightG(r.weight_g);
  const metalLabelStr = metalOnly(r.metal);
  const mintName = r.mint && String(r.mint).trim() ? String(r.mint).trim() : undefined;
  const mintLogoUrl = mintName && mintLogoMap.get(mintName) ? mintLogoMap.get(mintName) : undefined;
  return {
    id: String(r.id),
    title: cleanTitle(r.title),
    country: (r.country as string) ?? "Россия",
    year: year ?? 0,
    faceValue: r.face_value as string | undefined,
    imageUrl,
    imageUrls: imageUrlsOut.length > 0 ? imageUrlsOut : undefined,
    seriesName: r.series as string | undefined,
    metalCode: metalCode ?? undefined,
    metalCodes: metalCodes.length > 0 ? metalCodes : undefined,
    metalLabel: metalLabelStr !== "—" ? metalLabelStr : undefined,
    mintName,
    mintShort: r.mint_short && String(r.mint_short).trim() ? String(r.mint_short).trim() : undefined,
    mintLogoUrl,
    weightLabel: weightLabel ?? undefined,
    weightG: weightG ?? undefined,
    rectangular: isRectangular(r.catalog_number, rectangularBases),
  };
}

function rowToDetailCoin(
  r: Row,
  mintLogoMap: Map<string, string>,
  firstImageSide: "obverse" | "reverse",
  rectangularBases: string[]
): DetailCoin {
  const releaseDate = r.release_date as string | null;
  const year = yearFromCatalogSuffix(r.catalog_suffix) ?? (releaseDate ? new Date(releaseDate).getFullYear() : null);
  const { imageUrl, imageUrls: imageUrlsOut } = buildImageUrls(r, firstImageSide);
  const metalCode = getMetalCodeAndColor(r.metal).code;
  const metalColor = getMetalCodeAndColor(r.metal).color;
  const metalCodes = getMetalCodes(r.metal);
  const mintName = r.mint && String(r.mint).trim() ? String(r.mint).trim() : undefined;
  const mintLogoUrl = mintName && mintLogoMap.get(mintName) ? mintLogoMap.get(mintName) : undefined;
  return {
    id: String(r.id),
    title: (r.title as string) ?? "",
    seriesName: r.series as string | undefined,
    imageUrl,
    imageUrls: imageUrlsOut.length > 0 ? imageUrlsOut : undefined,
    inCollection: false,
    mintName: (r.mint as string) ?? "—",
    mintShort: r.mint_short && String(r.mint_short).trim() ? String(r.mint_short).trim() : undefined,
    mintCountry: (r.country as string) ?? "Россия",
    year,
    faceValue: (r.face_value as string) ?? "—",
    metal: metalOnly(r.metal),
    metalCode: metalCode ?? undefined,
    metalColor: metalColor ?? undefined,
    metalCodes: metalCodes.length > 0 ? metalCodes : undefined,
    mintage: r.mintage as string | number | undefined,
    mintageDisplay: r.mintage_display as string | undefined,
    weightG: r.weight_g != null && r.weight_g !== "" ? String(r.weight_g).trim() : undefined,
    weightOz: r.weight_oz != null && r.weight_oz !== "" ? String(r.weight_oz).trim() : undefined,
    purity: r.metal_fineness as string | undefined,
    quality: r.quality as string | undefined,
    diameterMm: r.diameter_mm as string | number | undefined,
    thicknessMm: r.thickness_mm as string | number | undefined,
    lengthMm: r.length_mm as string | number | undefined,
    widthMm: r.width_mm as string | number | undefined,
    catalogSuffix: r.catalog_suffix as string | undefined,
    rectangular: isRectangular(r.catalog_number, rectangularBases),
    mintLogoUrl,
  };
}

function rowToSameSeriesItem(
  s: Row,
  firstImageSide: "obverse" | "reverse",
  rectangularBases: string[]
): SameSeriesItem {
  const rev = reverseUrl(s.image_reverse);
  const obv = obverseUrl(s.image_obverse);
  const si = firstImageSide === "reverse" ? (rev ?? obv) : (obv ?? rev);
  const si2 = si ?? firstImageUrl(s.image_urls, null, s.image_obverse) ?? "";
  const metalCode = getMetalCodeAndColor(s.metal).code;
  const metalColor = getMetalCodeAndColor(s.metal).color;
  const metalCodes = getMetalCodes(s.metal);
  const metalName = metalOnly(s.metal);
  const weightG = s.weight_g != null && s.weight_g !== "" ? String(s.weight_g).trim() : undefined;
  return {
    id: String(s.id),
    title: (s.title as string) ?? "",
    seriesName: s.series as string | undefined,
    faceValue: (s.face_value as string) ?? "—",
    imageUrl: si2 || PLACEHOLDER,
    metalCode: metalCode ?? undefined,
    metalColor: metalColor ?? undefined,
    metalCodes: metalCodes.length > 0 ? metalCodes : undefined,
    metalName: metalName !== "—" ? metalName : undefined,
    weightG,
    rectangular: isRectangular(s.catalog_number, rectangularBases),
  };
}

const COINS_SELECT =
  `SELECT id, title, series, country, face_value, release_date, image_urls, catalog_number, catalog_suffix, image_obverse, image_reverse, image_box, image_certificate, mint, mint_short, metal, metal_fineness, mintage, mintage_display, weight_g, weight_oz, quality, diameter_mm, thickness_mm, length_mm, width_mm
   FROM coins ORDER BY release_date DESC, id DESC`;

export async function getCoinsList(): Promise<{ coins: ListCoin[]; total: number }> {
  const conn = await getConnection();
  try {
    const firstImageSide = getFirstImageSide();
    const rectangularBases = getRectangularBases();
    let mintLogoMap = new Map<string, string>();
    try {
      const [mintRows] = await conn.execute("SELECT name, logo_url FROM mints");
      for (const m of mintRows as Row[]) {
        if (m.name && m.logo_url) mintLogoMap.set(String(m.name).trim(), String(m.logo_url));
      }
    } catch {
      // mints может отсутствовать
    }
    const [rows] = await conn.execute(COINS_SELECT);
    const list = (rows as Row[]).filter(hasImage).map((r) => rowToListCoin(r, mintLogoMap, firstImageSide, rectangularBases));
    return { coins: list, total: list.length };
  } finally {
    await conn.end();
  }
}

export async function getCoinWithSameSeries(id: string): Promise<{ coin: DetailCoin; sameSeries: SameSeriesItem[] } | null> {
  const conn = await getConnection();
  try {
    const firstImageSide = getFirstImageSide();
    const rectangularBases = getRectangularBases();
    let mintLogoMap = new Map<string, string>();
    try {
      const [mintRows] = await conn.execute("SELECT name, logo_url FROM mints");
      for (const m of mintRows as Row[]) {
        if (m.name && m.logo_url) mintLogoMap.set(String(m.name).trim(), String(m.logo_url));
      }
    } catch {
      // ignore
    }
    const [rows] = await conn.execute(
      `SELECT id, title, series, country, face_value, release_date, image_urls, catalog_number, catalog_suffix, image_obverse, image_reverse, image_box, image_certificate, mint, mint_short, metal, metal_fineness, mintage, mintage_display, weight_g, weight_oz, quality, diameter_mm, thickness_mm, length_mm, width_mm
       FROM coins WHERE id = ?`,
      [id]
    );
    const arr = rows as Row[];
    if (!arr.length || !hasImage(arr[0])) return null;
    const coin = rowToDetailCoin(arr[0], mintLogoMap, firstImageSide, rectangularBases);
    const seriesName = arr[0].series as string | null;
    let sameSeries: SameSeriesItem[] = [];
    if (seriesName) {
      const [sameRows] = await conn.execute(
        `SELECT id, title, series, face_value, metal, weight_g, weight_oz, image_urls, catalog_number, image_obverse, image_reverse FROM coins
         WHERE series = ? AND id != ? ORDER BY release_date DESC LIMIT 12`,
        [seriesName, id]
      );
      sameSeries = (sameRows as Row[])
        .filter(hasImage)
        .slice(0, 6)
        .map((s) => rowToSameSeriesItem(s, firstImageSide, rectangularBases));
    }
    return { coin, sameSeries };
  } finally {
    await conn.end();
  }
}
