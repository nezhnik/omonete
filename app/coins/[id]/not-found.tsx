import type { Metadata } from "next";
import { CoinMissingView } from "../../../components/CoinMissingView";

export const metadata: Metadata = {
  title: "Монета не найдена — Omonete",
  description: "Такой страницы больше нет или в адресе ошибка.",
  robots: { index: false, follow: true },
};

export default function CoinDetailNotFound() {
  return <CoinMissingView />;
}
