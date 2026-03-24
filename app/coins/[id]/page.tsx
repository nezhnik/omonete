import fs from "fs";
import path from "path";
import type { Metadata } from "next";
import { Suspense } from "react";
import type { CoinDetailData, CoinSeriesItem } from "../../../components/CoinDetail";
import {
  coinCanonicalPath,
  coinJsonLdGraph,
  coinOpenGraphImageUrls,
  coinSeoDescription,
  coinSeoTitle,
} from "../../../lib/coin-page-seo";
import { absolutePageUrl } from "../../../lib/site-url";
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

type CoinPagePayload = { coin: CoinDetailData; sameSeries: CoinSeriesItem[] } | null;

function loadCoinPayload(id: string): CoinPagePayload {
  try {
    const jsonPath = path.join(process.cwd(), "public", "data", "coins", `${id}.json`);
    const raw = fs.readFileSync(jsonPath, "utf8");
    return JSON.parse(raw) as CoinPagePayload;
  } catch {
    return null;
  }
}

type Props = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  const initialData = loadCoinPayload(id);
  if (!initialData?.coin) {
    return {
      title: "Монета не найдена — Omonete",
      description: "Такой монеты нет в каталоге Omonete.",
      robots: { index: false, follow: true },
    };
  }
  const coin = initialData.coin;
  const title = coinSeoTitle(coin);
  const description = coinSeoDescription(coin);
  const canonical = absolutePageUrl(coinCanonicalPath(id));
  const ogImages = coinOpenGraphImageUrls(coin).map((url) => ({ url }));

  return {
    title,
    description,
    alternates: { canonical },
    openGraph: {
      title,
      description,
      url: canonical,
      siteName: "Omonete",
      locale: "ru_RU",
      type: "website",
      images: ogImages,
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: ogImages.map((i) => i.url.toString()),
    },
  };
}

function CoinJsonLdScript({ coin, coinId }: { coin: CoinDetailData; coinId: string }) {
  const graph = coinJsonLdGraph(coin, coinId);
  return (
    <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(graph) }} />
  );
}

export default async function CoinPage({ params }: Props) {
  const { id } = await params;
  const initialData = loadCoinPayload(id);
  return (
    <>
      {initialData?.coin ? <CoinJsonLdScript coin={initialData.coin} coinId={id} /> : null}
      <Suspense fallback={<div className="min-h-screen bg-white" />}>
        <CoinPageClient id={id} initialData={initialData} />
      </Suspense>
    </>
  );
}
