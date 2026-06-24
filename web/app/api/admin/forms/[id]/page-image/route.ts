import { error, withAuth } from "@/lib/http";
import { prisma } from "@/lib/db";
import { hasRole } from "@/lib/roles";
import { getObjectBytes } from "@/lib/s3";
import { renderPagePng } from "@/lib/form-ai/render";

type Ctx = { params: Promise<{ id: string }> };

// Rendering a page calls pdfjs + canvas — give it room and bound page count.
export const maxDuration = 60;
const MAX_PAGE = 50;

// GET /api/admin/forms/:id/page-image?page=N — the rendered PDF page (PNG) that
// backs the placement overlay. Admin only. Same renderer/DPI as the vision path,
// so the detected boxes the overlay draws line up with what vision actually saw.
export async function GET(req: Request, ctx: Ctx): Promise<Response> {
  const { id } = await ctx.params;
  return (await withAuth(req, async (claims): Promise<Response> => {
    if (!hasRole(claims.roles, ["admin"])) return error("forbidden", 403);

    const page = Number(new URL(req.url).searchParams.get("page") ?? "1");
    if (!Number.isInteger(page) || page < 1 || page > MAX_PAGE) {
      return error("invalid page", 400);
    }

    const form = await prisma.uploaded_forms.findUnique({
      where: { id },
      select: { source_s3_key: true },
    });
    if (!form) return error("form not found", 404);

    let png: Buffer;
    try {
      png = await renderPagePng(await getObjectBytes(form.source_s3_key), page);
    } catch (err) {
      console.error("page render failed", err);
      return error("could not render page", 500);
    }
    return new Response(new Uint8Array(png), {
      headers: {
        "content-type": "image/png",
        // Private (pre-signed-equivalent admin content); page images are immutable
        // for a given form, so let the browser cache during the review session.
        "cache-control": "private, max-age=3600",
      },
    });
  })) as Response;
}
