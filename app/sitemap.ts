import type { MetadataRoute } from "next";
import fs from "fs";
import path from "path";

export const dynamic = "force-static";

const SITE_URL =
  process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/+$/, "") ||
  process.env.SITE_URL?.replace(/\/+$/, "") ||
  "https://omonete.ru";

function withSlash(urlPath: string): string {
  const p = urlPath.startsWith("/") ? urlPath : `/${urlPath}`;
  return `${SITE_URL}${p.endsWith("/") ? p : `${p}/`}`;
}

function readJsonSafe<T>(absPath: string, fallback: T): T {
  try {
    if (!fs.existsSync(absPath)) return fallback;
    return JSON.parse(fs.readFileSync(absPath, "utf8")) as T;
  } catch {
    return fallback;
  }
}

export default function sitemap(): MetadataRoute.Sitemap {
  const dataDir = path.join(process.cwd(), "public", "data");
  const coinIdsPath = path.join(dataDir, "coin-ids.json");
  const mintsPath = path.join(dataDir, "mints.json");

  const coinIds = readJsonSafe<string[]>(coinIdsPath, []);
  const mints = readJsonSafe<{ mints?: Array<{ slug?: string; id?: string }> }>(mintsPath, {
    mints: [],
  }).mints ?? [];

  const now = new Date();
  const basePages: MetadataRoute.Sitemap = [
    { url: withSlash("/"), lastModified: now, changeFrequency: "daily", priority: 1 },
    { url: withSlash("/catalog"), lastModified: now, changeFrequency: "daily", priority: 0.95 },
    { url: withSlash("/charts"), lastModified: now, changeFrequency: "weekly", priority: 0.7 },
    { url: withSlash("/mints"), lastModified: now, changeFrequency: "weekly", priority: 0.8 },
  ];

  const mintPages: MetadataRoute.Sitemap = mints
    .map((m) => String(m.slug || m.id || "").trim())
    .filter(Boolean)
    .map((slug) => ({
      url: withSlash(`/mints/${slug}`),
      lastModified: now,
      changeFrequency: "weekly" as const,
      priority: 0.7,
    }));

  const coinPages: MetadataRoute.Sitemap = coinIds
    .map((id) => String(id).trim())
    .filter(Boolean)
    .map((id) => ({
      url: withSlash(`/coins/${id}`),
      lastModified: now,
      changeFrequency: "weekly" as const,
      priority: 0.6,
    }));

  return [...basePages, ...mintPages, ...coinPages];
}
