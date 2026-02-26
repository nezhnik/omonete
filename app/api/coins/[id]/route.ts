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
  try {
    const data = await getCoinWithSameSeries(id);
    if (!data) {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }
    return NextResponse.json(data);
  } catch (err) {
    console.error("API coin by id:", err);
    return NextResponse.json(
      { error: "database_unavailable" },
      { status: 503 }
    );
  }
}
