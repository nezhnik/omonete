import { NextRequest, NextResponse } from "next/server";
import { getCoinWithSameSeries } from "../../../../lib/coinApiShape";

export const dynamic = "force-dynamic";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  if (!id) {
    return NextResponse.json({ error: "missing_id" }, { status: 400 });
  }
  const noStore = { "Cache-Control": "no-store, max-age=0" };
  try {
    const data = await getCoinWithSameSeries(id);
    if (!data) {
      return NextResponse.json({ error: "not_found" }, { status: 404, headers: noStore });
    }
    return NextResponse.json(data, { headers: noStore });
  } catch (err) {
    console.error("API coin by id:", err);
    return NextResponse.json(
      { error: "database_unavailable" },
      { status: 503, headers: noStore }
    );
  }
}
