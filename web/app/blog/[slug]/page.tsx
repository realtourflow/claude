import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getPostBySlug } from "@/lib/notion";
import { prepareScopedPost, POST_SCOPE } from "@/lib/blog-html";
import BlogShell from "@/components/blog/BlogShell";

const SITE = "RealTourFlow";

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

  // The post body is a full HTML document stored in Notion. Extract its body +
  // styles and inject them, with the CSS scoped to `.rtf-post` so it can't
  // collide with the site's global styles.
  const { css, bodyHtml } = prepareScopedPost(post.html);

  return (
    <BlogShell>
      <article style={{ maxWidth: 860, margin: "0 auto", padding: "40px 24px 72px" }}>
        <Link
          href="/blog"
          style={{ fontSize: 14, fontWeight: 500, color: "#4b5563", textDecoration: "none" }}
        >
          ← All posts
        </Link>

        {css && <style dangerouslySetInnerHTML={{ __html: css }} />}

        {bodyHtml ? (
          <div
            className={POST_SCOPE}
            style={{ marginTop: 24 }}
            dangerouslySetInnerHTML={{ __html: bodyHtml }}
          />
        ) : (
          <p style={{ marginTop: 24, fontSize: 16, color: "#6b7280" }}>
            This post doesn&rsquo;t have any content yet.
          </p>
        )}
      </article>
    </BlogShell>
  );
}
