import type { Metadata } from "next";
import "./globals.css";
import { Providers } from "../components/Providers";

export const metadata: Metadata = {
  title: "Omonete — каталог монет",
  description: "Каталог монет со всего мира, коллекции и монетные дворы",
  icons: {
    icon: "/image/logo.png",
    apple: "/image/logo.png",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ru">
      <head>
        <link rel="icon" href="/favicon.ico" sizes="any" />
        <link rel="icon" href="/image/logo.png" type="image/png" />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Montserrat:wght@400;500;600;700&display=swap"
        />
        <link rel="preload" href="/data/coins.json" as="fetch" />
      </head>
      <body className="bg-white overflow-x-hidden" style={{ fontFamily: "Montserrat, system-ui, -apple-system, sans-serif" }}>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
