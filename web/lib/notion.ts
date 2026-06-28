/**
 * Notion-backed marketing blog. Reads published posts from the "Blog Posts"
 * database (one row per post) and renders them on /blog of the marketing site.
 *
 * - getPublishedPosts(site): list cards for a site ("RealTourFlow", …).
 * - getPostBySlug(site, slug): one post's metadata + its block tree.
 *
 * A post is live for a site only when Status = "Published" AND its "Publish To"
 * multi-select contains that site. Same database can feed multiple websites.
 *
 * Pinned to the 2022-06-28 Notion API so `databases.query({database_id})` with
 * property filters works regardless of the SDK's default version.
 *
 * Test seam: setNotionForTesting() injects a fake client (or null to simulate
 * an unconfigured blog), so tests never hit the network.
 */
import { Client } from "@notionhq/client";
import { env } from "./env";

export type BlogPostMeta = {
  id: string;
  title: string;
  slug: string;
  excerpt: string;
  date: string | null;
  author: string;
  tags: string[];
  coverUrl: string | null;
};

export type NotionAnnotations = {
  bold: boolean;
  italic: boolean;
  strikethrough: boolean;
  underline: boolean;
  code: boolean;
  color: string;
};

export type RichText = {
  plain_text: string;
  href: string | null;
  annotations: NotionAnnotations;
};

/** A Notion block plus any recursively-fetched children (tables, callouts, …). */
export type NotionBlock = {
  id: string;
  type: string;
  has_children: boolean;
  children?: NotionBlock[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [key: string]: any;
};

let stub: Client | null | undefined;

/** Inject a fake client for tests, or `null` to simulate an unconfigured blog. */
export function setNotionForTesting(client: Client | null): void {
  stub = client;
}

let real: Client | undefined;

function client(): Client | null {
  if (stub !== undefined) return stub;
  const token = env().NOTION_TOKEN;
  if (!token) return null;
  if (!real) real = new Client({ auth: token, notionVersion: "2022-06-28" });
  return real;
}

function plain(arr: unknown): string {
  return Array.isArray(arr) ? (arr as RichText[]).map((t) => t.plain_text).join("") : "";
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function metaFromPage(page: any): BlogPostMeta {
  const props = page.properties ?? {};
  const coverFiles = props["Cover Image"]?.files ?? [];
  const coverUrl =
    page.cover?.external?.url ??
    page.cover?.file?.url ??
    coverFiles[0]?.external?.url ??
    coverFiles[0]?.file?.url ??
    null;
  return {
    id: page.id,
    title: plain(props.Title?.title),
    slug: plain(props.Slug?.rich_text),
    excerpt: plain(props.Excerpt?.rich_text),
    date: props["Publish Date"]?.date?.start ?? null,
    author: plain(props.Author?.rich_text),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    tags: (props.Tags?.multi_select ?? []).map((t: any) => t.name),
    coverUrl,
  };
}

function publishedFilter(site: string) {
  return {
    and: [
      { property: "Status", select: { equals: "Published" } },
      { property: "Publish To", multi_select: { contains: site } },
    ],
  };
}

/** All published posts for a site, newest first. Empty if blog isn't configured. */
export async function getPublishedPosts(site: string): Promise<BlogPostMeta[]> {
  const notion = client();
  const databaseId = env().NOTION_BLOG_DATABASE_ID;
  if (!notion || !databaseId) return [];

  const res = await notion.databases.query({
    database_id: databaseId,
    filter: publishedFilter(site),
    sorts: [{ property: "Publish Date", direction: "descending" }],
    page_size: 100,
  });
  return res.results.map(metaFromPage).filter((p) => p.slug);
}

/** One published post (metadata + rendered block tree), or null if not found. */
export async function getPostBySlug(
  site: string,
  slug: string
): Promise<{ meta: BlogPostMeta; blocks: NotionBlock[] } | null> {
  const notion = client();
  const databaseId = env().NOTION_BLOG_DATABASE_ID;
  if (!notion || !databaseId) return null;

  const res = await notion.databases.query({
    database_id: databaseId,
    filter: {
      and: [publishedFilter(site), { property: "Slug", rich_text: { equals: slug } }],
    },
    page_size: 1,
  });
  const page = res.results[0];
  if (!page) return null;

  const meta = metaFromPage(page);
  const blocks = await fetchBlocks(notion, page.id);
  return { meta, blocks };
}

/** Recursively fetch a block's children so tables / callouts / lists render whole. */
async function fetchBlocks(notion: Client, blockId: string): Promise<NotionBlock[]> {
  const out: NotionBlock[] = [];
  let cursor: string | undefined;
  do {
    const res = await notion.blocks.children.list({
      block_id: blockId,
      start_cursor: cursor,
      page_size: 100,
    });
    for (const raw of res.results) {
      const block = raw as NotionBlock;
      if (block.has_children) {
        block.children = await fetchBlocks(notion, block.id);
      }
      out.push(block);
    }
    cursor = res.has_more ? (res.next_cursor ?? undefined) : undefined;
  } while (cursor);
  return out;
}
