/**
 * Однократный экспорт MINT_ARTICLES в JSON (для сохранения в mint-articles.json и импорта в БД).
 * Откройте в браузере /api/mint-articles-export и сохраните страницу как mint-articles.json в корень проекта.
 */
import { NextResponse } from "next/server";
import { MINT_ARTICLES } from "../../../lib/mint-articles";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(MINT_ARTICLES, {
    headers: {
      "Content-Disposition": 'attachment; filename="mint-articles.json"',
    },
  });
}
