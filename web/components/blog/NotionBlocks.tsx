/**
 * Renders a Notion block tree (from lib/notion.ts) into styled JSX for the blog.
 * Handles the block types our posts use — paragraphs, headings, lists, quotes,
 * callouts, tables, images, code, dividers — and falls back to plain text for
 * anything unrecognized so a post never crashes the page.
 */
import type { NotionBlock, RichText as RichTextType } from "@/lib/notion";

const navy = "#00163b";
const text = "#1f2937";
const muted = "#6b7280";
const border = "#e5e7eb";
const infoBg = "#eff6ff";
const infoBorder = "#bfdbfe";

function RichText({ rich }: { rich: RichTextType[] | undefined }) {
  return (
    <>
      {(rich ?? []).map((t, i) => {
        const a = t.annotations ?? ({} as RichTextType["annotations"]);
        let node: React.ReactNode = t.plain_text;
        if (a.code)
          node = (
            <code
              style={{
                background: "#f3f4f6",
                borderRadius: 4,
                padding: "1px 5px",
                fontSize: "0.9em",
                fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
              }}
            >
              {node}
            </code>
          );
        if (a.bold) node = <strong>{node}</strong>;
        if (a.italic) node = <em>{node}</em>;
        if (a.strikethrough) node = <s>{node}</s>;
        if (a.underline) node = <u>{node}</u>;
        if (t.href)
          node = (
            <a href={t.href} style={{ color: "#1e40af", textDecoration: "underline" }}>
              {node}
            </a>
          );
        return <span key={i}>{node}</span>;
      })}
    </>
  );
}

function richOf(block: NotionBlock): RichTextType[] {
  return (block[block.type]?.rich_text ?? []) as RichTextType[];
}

function Block({ block }: { block: NotionBlock }) {
  const type = block.type;
  switch (type) {
    case "paragraph": {
      const rich = richOf(block);
      if (rich.length === 0) return <div style={{ height: 12 }} />;
      return (
        <p style={{ margin: "0 0 18px", fontSize: 18, lineHeight: 1.75, color: text }}>
          <RichText rich={rich} />
        </p>
      );
    }
    case "heading_1":
      return (
        <h2 style={{ margin: "40px 0 14px", fontSize: 28, fontWeight: 700, color: navy, lineHeight: 1.3 }}>
          <RichText rich={richOf(block)} />
        </h2>
      );
    case "heading_2":
      return (
        <h2 style={{ margin: "36px 0 12px", fontSize: 24, fontWeight: 700, color: navy, lineHeight: 1.3 }}>
          <RichText rich={richOf(block)} />
        </h2>
      );
    case "heading_3":
      return (
        <h3 style={{ margin: "28px 0 10px", fontSize: 20, fontWeight: 600, color: navy, lineHeight: 1.35 }}>
          <RichText rich={richOf(block)} />
        </h3>
      );
    case "quote":
      return (
        <blockquote
          style={{
            margin: "0 0 22px",
            padding: "6px 0 6px 20px",
            borderLeft: `3px solid ${navy}`,
            fontSize: 20,
            fontStyle: "italic",
            color: navy,
            lineHeight: 1.5,
          }}
        >
          <RichText rich={richOf(block)} />
          {block.children && <Blocks blocks={block.children} />}
        </blockquote>
      );
    case "callout": {
      const icon = block.callout?.icon?.emoji ?? "💡";
      return (
        <div
          style={{
            display: "flex",
            gap: 12,
            margin: "0 0 22px",
            padding: "18px 20px",
            background: infoBg,
            border: `1px solid ${infoBorder}`,
            borderRadius: 12,
          }}
        >
          <span style={{ fontSize: 22, lineHeight: 1.4, flexShrink: 0 }}>{icon}</span>
          <div style={{ fontSize: 16, lineHeight: 1.7, color: text }}>
            <RichText rich={richOf(block)} />
            {block.children && <Blocks blocks={block.children} />}
          </div>
        </div>
      );
    }
    case "divider":
      return <hr style={{ border: 0, borderTop: `1px solid ${border}`, margin: "32px 0" }} />;
    case "image": {
      const img = block.image ?? {};
      const url = img.external?.url ?? img.file?.url ?? "";
      const caption = (img.caption ?? []) as RichTextType[];
      if (!url) return null;
      return (
        <figure style={{ margin: "0 0 24px" }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={url} alt={caption.map((c) => c.plain_text).join("")} style={{ width: "100%", borderRadius: 12, display: "block" }} />
          {caption.length > 0 && (
            <figcaption style={{ fontSize: 13, color: muted, marginTop: 8, textAlign: "center" }}>
              <RichText rich={caption} />
            </figcaption>
          )}
        </figure>
      );
    }
    case "code":
      return (
        <pre
          style={{
            margin: "0 0 22px",
            padding: 16,
            background: "#0f172a",
            color: "#e2e8f0",
            borderRadius: 10,
            overflowX: "auto",
            fontSize: 14,
            lineHeight: 1.6,
            fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
          }}
        >
          <code>{richOf(block).map((t) => t.plain_text).join("")}</code>
        </pre>
      );
    case "table": {
      const rows = (block.children ?? []).filter((b) => b.type === "table_row");
      const hasHeader = block.table?.has_column_header ?? false;
      return (
        <div style={{ overflowX: "auto", margin: "0 0 24px" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 15 }}>
            <tbody>
              {rows.map((row, ri) => {
                const cells = (row.table_row?.cells ?? []) as RichTextType[][];
                const isHeader = hasHeader && ri === 0;
                const Tag = isHeader ? "th" : "td";
                return (
                  <tr key={row.id}>
                    {cells.map((cell, ci) => (
                      <Tag
                        key={ci}
                        style={{
                          border: `1px solid ${border}`,
                          padding: "10px 14px",
                          textAlign: "left",
                          verticalAlign: "top",
                          background: isHeader ? navy : ci === 0 ? "#f9fafb" : "#fff",
                          color: isHeader ? "#fff" : text,
                          fontWeight: isHeader || ci === 0 ? 600 : 400,
                          lineHeight: 1.5,
                        }}
                      >
                        <RichText rich={cell} />
                      </Tag>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      );
    }
    default:
      // Unhandled block: render its text if it has any, else skip.
      if (block[type]?.rich_text)
        return (
          <p style={{ margin: "0 0 18px", fontSize: 18, lineHeight: 1.75, color: text }}>
            <RichText rich={richOf(block)} />
          </p>
        );
      return null;
  }
}

/** Renders a flat block list, grouping consecutive list items into <ul>/<ol>. */
export default function Blocks({ blocks }: { blocks: NotionBlock[] }) {
  const out: React.ReactNode[] = [];
  let i = 0;
  while (i < blocks.length) {
    const b = blocks[i];
    if (b.type === "bulleted_list_item" || b.type === "numbered_list_item") {
      const ordered = b.type === "numbered_list_item";
      const items: NotionBlock[] = [];
      while (i < blocks.length && blocks[i].type === b.type) {
        items.push(blocks[i]);
        i++;
      }
      const ListTag = ordered ? "ol" : "ul";
      out.push(
        <ListTag key={items[0].id} style={{ margin: "0 0 20px", paddingLeft: 24 }}>
          {items.map((item) => (
            <li key={item.id} style={{ margin: "0 0 8px", fontSize: 18, lineHeight: 1.7, color: text }}>
              <RichText rich={richOf(item)} />
              {item.children && <Blocks blocks={item.children} />}
            </li>
          ))}
        </ListTag>
      );
      continue;
    }
    out.push(<Block key={b.id} block={b} />);
    i++;
  }
  return <>{out}</>;
}
