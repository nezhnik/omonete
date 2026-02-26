import { NextResponse } from "next/server";
import { getCoinsList } from "../../../lib/coinApiShape";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const { coins, total } = await getCoinsList();
    return NextResponse.json({ coins, total });
  } catch (err) {
    console.error("API coins list:", err);
    return NextResponse.json(
      { error: "database_unavailable" },
      { status: 503 }
    );
  }
}
