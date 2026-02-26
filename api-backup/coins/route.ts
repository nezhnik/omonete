import { NextRequest } from "next/server";
import { getConnection } from "@/lib/db";
import { firstImageUrl } from "@/lib/coinImages";

export const dynamic = "force-static";
const PLACEHOLDER = "/image/coin-placeholder.svg";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const limit = Math.min(Number(searchParams.get("limit")) || 30, 100);
  const offset = Number(searchParams.get("offset")) || 0;

  try {
    const conn = await getConnection();
    const [rows] = await conn.execute(
      `SELECT id, title, series, country, face_value, metal, release_date, image_urls, catalog_number, image_obverse
       FROM coins ORDER BY release_date DESC, id DESC LIMIT ? OFFSET ?`,
      [limit, offset]
    );
    const [countRows] = await conn.execute("SELECT COUNT(*) as total FROM coins");
    const total = (countRows as { total: number }[])[0]?.total ?? 0;
    conn.end();

    const coins = (rows as Record<string, unknown>[]).map((r) => {
      const imageUrls = r.image_urls as string[] | null;
      const catalogNumber = r.catalog_number as string | null;
      const imageObverse = r.image_obverse as string | null;
      const firstImage = firstImageUrl(imageUrls, catalogNumber, imageObverse);
      const releaseDate = r.release_date as string | null;
      const year = releaseDate ? new Date(releaseDate).getFullYear() : null;

      return {
        id: String(r.id),
        title: r.title,
        country: r.country ?? "Россия",
        year: year ?? 0,
        faceValue: r.face_value ?? undefined,
        imageUrl: firstImage ?? PLACEHOLDER,
        seriesName: r.series ?? undefined,
      };
    });

    return Response.json({ coins, total });
  } catch (err) {
    console.error("API coins list:", err);
    return Response.json(
      { error: "Ошибка загрузки каталога" },
      { status: 500 }
    );
  }
}
