import type { MetadataRoute } from "next";
import { getPublishedPosts } from "@/lib/notion";

const BASE = "https://realtourflow.com";

// Re-generate hourly so newly-published posts enter the sitemap without a deploy.
export const revalidate = 3600;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  let posts: Awaited<ReturnType<typeof getPublishedPosts>> = [];
  try {
    posts = await getPublishedPosts("RealTourFlow");
  } catch {
    posts = [];
  }

  const postEntries: MetadataRoute.Sitemap = posts.map((p) => ({
    url: `${BASE}/blog/${p.slug}`,
    lastModified: p.date ? new Date(p.date) : undefined,
    changeFrequency: "monthly",
    priority: 0.7,
  }));

  return [
    { url: `${BASE}/`, changeFrequency: "weekly", priority: 1 },
    { url: `${BASE}/blog`, changeFrequency: "weekly", priority: 0.8 },
    ...postEntries,
  ];
}
