import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: { userAgent: "*", allow: "/" },
    sitemap: "https://www.realtourflow.com/sitemap.xml",
    host: "https://www.realtourflow.com",
  };
}
