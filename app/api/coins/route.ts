import { NextResponse } from "next/server";
import { getCoinsList } from "../../../lib/coinApiShape";

export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store, max-age=0" };

export async function GET() {
  try {
    const { coins, total } = await getCoinsList();
    return NextResponse.json({ coins, total }, { headers: NO_STORE });
  } catch (err) {
    console.error("API coins list:", err);
    return NextResponse.json(
      { error: "database_unavailable" },
      { status: 503, headers: NO_STORE }
    );
  }
}
