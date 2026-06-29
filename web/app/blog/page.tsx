import type { Metadata } from "next";
import Link from "next/link";
import { getPublishedPosts } from "@/lib/notion";
import BlogShell from "@/components/blog/BlogShell";

const SITE = "RealTourFlow";

export const metadata: Metadata = {
  title: "Blog — RealTourFlow",
  description:
    "Guides, comparisons, and tips for real estate agents who want to run cleaner transactions. From the team building RealTourFlow.",
  alternates: { canonical: "https://www.realtourflow.com/blog" },
};

const S = {
  navy: "#00163b",
  white: "#ffffff",
  border: "#e5e7eb",
  text: "#1f2937",
  textSecondary: "#4b5563",
  textMuted: "#9ca3af",
  infoBg: "#eff6ff",
  infoText: "#1e40af",
};

function formatDate(date: string | null): string {
  if (!date) return "";
  return new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  }).format(new Date(date));
}

export default async function BlogIndex() {
  const posts = await getPublishedPosts(SITE);

  return (
    <BlogShell>
      <section style={{ maxWidth: 820, margin: "0 auto", padding: "64px 24px 24px" }}>
        <h1
          style={{
            fontSize: "clamp(32px, 5vw, 44px)",
            fontWeight: 700,
            color: S.navy,
            letterSpacing: "-0.025em",
            margin: "0 0 12px",
          }}
        >
          The RealTourFlow Blog
        </h1>
        <p style={{ fontSize: 18, color: S.textSecondary, lineHeight: 1.7, margin: 0 }}>
          Guides, comparisons, and tips for agents who want cleaner, faster transactions.
        </p>
      </section>

      <section style={{ maxWidth: 820, margin: "0 auto", padding: "8px 24px 80px" }}>
        {posts.length === 0 ? (
          <div
            style={{
              background: S.white,
              border: `1px solid ${S.border}`,
              borderRadius: 16,
              padding: "48px 32px",
              textAlign: "center",
            }}
          >
            <p style={{ fontSize: 18, fontWeight: 600, color: S.navy, margin: "0 0 8px" }}>
              No posts yet.
            </p>
            <p style={{ fontSize: 15, color: S.textMuted, margin: 0 }}>
              We&rsquo;re writing the first ones now — check back soon.
            </p>
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
            {posts.map((post) => (
              <Link
                key={post.id}
                href={`/blog/${post.slug}`}
                style={{
                  display: "block",
                  background: S.white,
                  border: `1px solid ${S.border}`,
                  borderRadius: 16,
                  padding: 28,
                  textDecoration: "none",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12, flexWrap: "wrap" }}>
                  {post.date && (
                    <span style={{ fontSize: 13, color: S.textMuted }}>{formatDate(post.date)}</span>
                  )}
                  {post.tags.map((tag) => (
                    <span
                      key={tag}
                      style={{
                        fontSize: 12,
                        fontWeight: 500,
                        color: S.infoText,
                        background: S.infoBg,
                        borderRadius: 999,
                        padding: "3px 10px",
                      }}
                    >
                      {tag}
                    </span>
                  ))}
                </div>
                <h2 style={{ fontSize: 22, fontWeight: 700, color: S.navy, margin: "0 0 8px", lineHeight: 1.3 }}>
                  {post.title}
                </h2>
                {post.excerpt && (
                  <p style={{ fontSize: 16, color: S.textSecondary, lineHeight: 1.6, margin: 0 }}>
                    {post.excerpt}
                  </p>
                )}
                <span
                  style={{
                    display: "inline-block",
                    marginTop: 14,
                    fontSize: 14,
                    fontWeight: 600,
                    color: S.navy,
                  }}
                >
                  Read more →
                </span>
              </Link>
            ))}
          </div>
        )}
      </section>
    </BlogShell>
  );
}
