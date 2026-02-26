import Link from "next/link";
import { Header } from "../../../components/Header";
import { MintArticle } from "../../../components/MintArticle";
import { fetchMintArticle } from "../../../lib/fetchMintArticle";
import { getMintArticleSlugs, getOtherMints } from "../../../lib/mint-articles";

export function generateStaticParams() {
  return getMintArticleSlugs().map((slug) => ({ slug }));
}

type Props = { params: Promise<{ slug: string }> };

export default async function MintPage({ params }: Props) {
  const { slug } = await params;
  const article = await fetchMintArticle(slug);

  if (!article) {
    return (
      <div className="min-h-screen bg-white">
        <Header activePath="/mints" />
        <main className="w-full px-4 sm:px-6 lg:px-20 py-12">
          <p className="text-[#666666]">Статья о монетном дворе не найдена.</p>
          <Link href="/mints" className="text-[#0098E8] font-medium pt-4 inline-block">
            На страницу монетных дворов
          </Link>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-white">
      <Header activePath="/mints" />
      <main className="w-full pt-6">
        <nav className="hidden lg:flex px-4 sm:px-6 lg:px-20 pb-6 items-center gap-2 min-w-0 text-[16px] font-medium text-[#666666]">
          <Link href="/" className="hover:text-black shrink-0">
            Главная
          </Link>
          <span className="shrink-0">/</span>
          <Link href="/#mints" className="hover:text-black truncate">
            Монетные дворы
          </Link>
          <span className="shrink-0">/</span>
          <span className="text-black truncate">{article.shortName}</span>
        </nav>
        <MintArticle
          article={article}
          backHref="/mints"
          backLabel="На страницу монетных дворов"
          otherMints={getOtherMints(article.slug, article.country ?? "Россия", 2)}
        />
      </main>
    </div>
  );
}
