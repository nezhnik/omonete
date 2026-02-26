import { NextRequest, NextResponse } from "next/server";
import { getConnection } from "../../../../lib/db";
import { getMintArticle } from "../../../../lib/mint-articles";

export const dynamic = "force-dynamic";

function parseJson<T>(val: unknown): T | null {
  if (val == null) return null;
  if (typeof val === "string") {
    try {
      return JSON.parse(val) as T;
    } catch {
      return null;
    }
  }
  return val as T;
}

function rowToArticle(r: Record<string, unknown>) {
  return {
    slug: r.slug,
    name: r.name,
    shortName: r.short_name,
    country: r.country ?? undefined,
    logoUrl: r.logo_url,
    galleryImages: parseJson<string[]>(r.gallery_images) ?? [],
    sections: parseJson<{ title: string; content: string }[]>(r.sections) ?? [],
    facts: parseJson<string[]>(r.facts) ?? [],
    famousCoins: parseJson(r.famous_coins) ?? undefined,
    sourcesLine: (r.sources_line as string) ?? undefined,
  };
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params;
  if (!slug) {
    return NextResponse.json({ error: "missing_slug" }, { status: 400 });
  }
  const normalizedSlug = slug.toLowerCase();

  try {
    const conn = await getConnection();
    try {
      const [rows] = await conn.execute(
        "SELECT slug, name, short_name, country, logo_url, gallery_images, sections, facts, famous_coins, sources_line FROM mint_articles WHERE slug = ?",
        [normalizedSlug]
      );
      await conn.end();
      const arr = rows as Record<string, unknown>[];
      if (arr.length > 0) {
        return NextResponse.json(rowToArticle(arr[0]), { headers: { "Cache-Control": "no-store, max-age=0" } });
      }
    } catch {
      await conn.end().catch(() => {});
    }
  } catch {
    // БД недоступна — fallback на код
  }

  const noStore = { "Cache-Control": "no-store, max-age=0" };
  const fromCode = getMintArticle(normalizedSlug);
  if (fromCode) {
    return NextResponse.json(fromCode, { headers: noStore });
  }
  return NextResponse.json({ error: "not_found" }, { status: 404, headers: noStore });
}
