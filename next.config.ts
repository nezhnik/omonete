import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  trailingSlash: true,
  output: "export", // статический экспорт в папку out для деплоя на Reg.ru
};

export default nextConfig;
