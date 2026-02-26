import fs from "fs";
import path from "path";
import { Suspense } from "react";
import type { CoinDetailData, CoinSeriesItem } from "../../../components/CoinDetail";
import { CoinPageClient } from "./CoinPageClient";

export function generateStaticParams() {
  try {
    const file = path.join(process.cwd(), "public", "data", "coin-ids.json");
    const ids = JSON.parse(fs.readFileSync(file, "utf8")) as string[];
    return ids.map((id) => ({ id }));
  } catch {
    return [];
  }
}

type Props = { params: Promise<{ id: string }> };

export default async function CoinPage({ params }: Props) {
  const { id } = await params;
  let initialData: { coin: CoinDetailData; sameSeries: CoinSeriesItem[] } | null = null;
  try {
    const jsonPath = path.join(process.cwd(), "public", "data", "coins", `${id}.json`);
    const raw = fs.readFileSync(jsonPath, "utf8");
    initialData = JSON.parse(raw) as { coin: CoinDetailData; sameSeries: CoinSeriesItem[] };
  } catch {
    // JSON нет — клиент покажет «Монета не найдена»
  }
  return (
    <Suspense fallback={<div className="min-h-screen bg-white" />}>
      <CoinPageClient id={id} initialData={initialData} />
    </Suspense>
  );
}
