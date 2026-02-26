import { getConnection } from "@/lib/db";
import { firstImageUrl, obverseUrl, reverseUrl } from "@/lib/coinImages";
import { getFirstImageSide } from "@/lib/coinDisplayConfig";
import { metalOnly } from "@/lib/coinMeta";

export const dynamic = "force-static";
const PLACEHOLDER = "/image/coin-placeholder.svg";

function rowToCoinDetail(r: Record<string, unknown>, firstImageSide: "obverse" | "reverse") {
  const imageUrls = r.image_urls as string[] | null;
  const catalogNumber = r.catalog_number as string | null;
  const imageObverse = r.image_obverse as string | null;
  const imageReverse = r.image_reverse as string | null;
  const imageBox = r.image_box as string | null;
  const imageCertificate = r.image_certificate as string | null;

  const obverse = obverseUrl(imageObverse, catalogNumber);
  const reverse = reverseUrl(imageReverse, catalogNumber);
  const firstImage = firstImageSide === "reverse" ? (reverse ?? obverse ?? "") : (obverse ?? reverse ?? "");

  const imageUrlsOut: string[] = [];
  if (firstImageSide === "reverse") {
    if (reverse) imageUrlsOut.push(reverse);
    if (obverse) imageUrlsOut.push(obverse);
  } else {
    if (obverse) imageUrlsOut.push(obverse);
    if (reverse) imageUrlsOut.push(reverse);
  }
  if (imageBox?.trim()) imageUrlsOut.push(imageBox.trim());
  if (imageCertificate?.trim()) imageUrlsOut.push(imageCertificate.trim());
  if (imageUrlsOut.length === 0 && Array.isArray(imageUrls) && imageUrls.length > 0) {
    imageUrlsOut.push(...imageUrls);
  }

  const releaseDate = r.release_date as string | null;
  const year = releaseDate ? new Date(releaseDate).getFullYear() : 0;

  return {
    id: String(r.id),
    title: r.title,
    seriesName: r.series ?? undefined,
    imageUrl: firstImage || PLACEHOLDER,
    imageUrls: imageUrlsOut.length > 0 ? imageUrlsOut : undefined,
    inCollection: false,
    mintName: (r.mint as string) ?? "—",
    mintCountry: (r.country as string) ?? "Россия",
    year,
    faceValue: (r.face_value as string) ?? "—",
    metal: metalOnly(r.metal as string),
    mintage: (r.mintage as number) ?? undefined,
    weightG: (r.weight_g as string) != null && (r.weight_g as string) !== "" ? String(r.weight_g).trim() : undefined,
    weightOz: (r.weight_oz as string) != null && (r.weight_oz as string) !== "" ? String(r.weight_oz).trim() : undefined,
    purity: (r.metal_fineness as string) ?? undefined,
  };
}

function rowToSeriesItem(r: Record<string, unknown>, firstImageSide: "obverse" | "reverse") {
  const imageUrls = r.image_urls as string[] | null;
  const catalogNumber = r.catalog_number as string | null;
  const imageObverse = r.image_obverse as string | null;
  const imageReverse = r.image_reverse as string | null;
  const reverse = reverseUrl(imageReverse, catalogNumber);
  const obverse = obverseUrl(imageObverse, catalogNumber);
  const firstImage = (firstImageSide === "reverse" ? (reverse ?? obverse) : (obverse ?? reverse)) ?? firstImageUrl(imageUrls, catalogNumber, imageObverse) ?? "";

  return {
    id: String(r.id),
    title: r.title,
    seriesName: r.series ?? undefined,
    faceValue: (r.face_value as string) ?? "—",
    imageUrl: firstImage || PLACEHOLDER,
  };
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const coinId = parseInt(id, 10);
  if (Number.isNaN(coinId)) {
    return Response.json({ error: "Неверный id" }, { status: 400 });
  }

  try {
    const conn = await getConnection();

    const [coinRows] = await conn.execute(
      `SELECT id, title, series, mint, country, face_value, metal, metal_fineness, mintage, weight_g, weight_oz, release_date, image_urls, catalog_number, image_obverse, image_reverse, image_box, image_certificate
       FROM coins WHERE id = ?`,
      [coinId]
    );

    const arr = coinRows as Record<string, unknown>[];
    if (!arr.length) {
      conn.end();
      return Response.json({ error: "Монета не найдена" }, { status: 404 });
    }

    const firstImageSide = getFirstImageSide();
    const coin = rowToCoinDetail(arr[0], firstImageSide);
    const seriesName = arr[0].series as string | null;

    let sameSeries: ReturnType<typeof rowToSeriesItem>[] = [];
    if (seriesName) {
      const [sameRows] = await conn.execute(
        `SELECT id, title, series, face_value, image_urls, catalog_number, image_obverse, image_reverse FROM coins
         WHERE series = ? AND id != ? ORDER BY release_date DESC LIMIT 6`,
        [seriesName, coinId]
      );
      sameSeries = (sameRows as Record<string, unknown>[]).map((row) => rowToSeriesItem(row, firstImageSide));
    }

    conn.end();
    return Response.json({ coin, sameSeries });
  } catch (err) {
    console.error("API coin detail:", err);
    return Response.json(
      { error: "Ошибка загрузки монеты" },
      { status: 500 }
    );
  }
}
