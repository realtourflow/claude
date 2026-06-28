import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getPostBySlug } from "@/lib/notion";
import BlogShell from "@/components/blog/BlogShell";
import Blocks from "@/components/blog/NotionBlocks";

const SITE = "RealTourFlow";

const S = {
  navy: "#00163b",
  textSecondary: "#4b5563",
  textMuted: "#9ca3af",
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

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const post = await getPostBySlug(SITE, slug);
  if (!post) return { title: "Post not found — RealTourFlow" };
  return {
    title: `${post.meta.title} — RealTourFlow`,
    description: post.meta.excerpt || undefined,
    alternates: { canonical: `https://realtourflow.com/blog/${slug}` },
    openGraph: {
      title: post.meta.title,
      description: post.meta.excerpt || undefined,
      images: post.meta.coverUrl ? [post.meta.coverUrl] : undefined,
      type: "article",
    },
  };
}

export default async function BlogPost({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const post = await getPostBySlug(SITE, slug);
  if (!post) notFound();

  const { meta, blocks } = post;

  return (
    <BlogShell>
      <article style={{ maxWidth: 720, margin: "0 auto", padding: "56px 24px 72px" }}>
        <Link
          href="/blog"
          style={{ fontSize: 14, fontWeight: 500, color: S.textSecondary, textDecoration: "none" }}
        >
          ← All posts
        </Link>

        <div style={{ display: "flex", alignItems: "center", gap: 12, margin: "24px 0 14px", flexWrap: "wrap" }}>
          {meta.date && <span style={{ fontSize: 14, color: S.textMuted }}>{formatDate(meta.date)}</span>}
          {meta.author && (
            <span style={{ fontSize: 14, color: S.textMuted }}>· {meta.author}</span>
          )}
        </div>

        <h1
          style={{
            fontSize: "clamp(30px, 5vw, 42px)",
            fontWeight: 700,
            color: S.navy,
            letterSpacing: "-0.025em",
            lineHeight: 1.2,
            margin: "0 0 28px",
          }}
        >
          {meta.title}
        </h1>

        {meta.coverUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={meta.coverUrl}
            alt={meta.title}
            style={{ width: "100%", borderRadius: 14, margin: "0 0 32px", display: "block" }}
          />
        )}

        <Blocks blocks={blocks} />
      </article>
    </BlogShell>
  );
}
