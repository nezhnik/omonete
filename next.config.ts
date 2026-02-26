import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // trailingSlash оставляем для удобных URL (/catalog/, /portfolio/ и т.п.)
  trailingSlash: true,
};

export default nextConfig;
