import { NextResponse } from "next/server";
import { getConnection } from "../../../lib/db";
import { getMintArticleSlugs } from "../../../lib/mint-articles";

export const dynamic = "force-dynamic";

/** Список slug статей: из БД или из кода (fallback). */
export async function GET() {
  try {
    const conn = await getConnection();
    try {
      const [rows] = await conn.execute("SELECT slug FROM mint_articles ORDER BY slug");
      const slugs = (rows as { slug: string }[]).map((r) => r.slug);
      await conn.end();
      if (slugs.length > 0) {
        return NextResponse.json({ slugs }, { headers: { "Cache-Control": "no-store, max-age=0" } });
      }
    } catch {
      await conn.end().catch(() => {});
    }
  } catch {
    // DATABASE_URL не задан или БД недоступна
  }
  const slugs = getMintArticleSlugs();
  return NextResponse.json({ slugs }, { headers: { "Cache-Control": "no-store, max-age=0" } });
}
