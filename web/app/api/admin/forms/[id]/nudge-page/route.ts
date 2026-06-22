import { error, json, withAuth } from "@/lib/http";
import { prisma } from "@/lib/db";
import { hasRole } from "@/lib/roles";

type Ctx = { params: Promise<{ id: string }> };
const MAX_NUDGE = 200; // points — a sane bound on a single bulk shift

// POST /api/admin/forms/:id/nudge-page — shift EVERY detected box on one page up or
// down by `dy` points, in one atomic update. Vision's vertical offset varies by
// page/layout, so a uniformly-off page is corrected in one motion instead of
// dragging each box. dy>0 = up (PDF bottom-left: pos_y increases). Clears the
// placement confirmation, same as a single drag. Only while pending_review. Admin.
export async function POST(req: Request, ctx: Ctx): Promise<Response> {
  const { id } = await ctx.params;
  return (await withAuth(req, async (claims): Promise<Response> => {
    if (!hasRole(claims.roles, ["admin"])) return error("forbidden", 403);

    let body: { page?: number; dy?: number };
    try {
      body = (await req.json()) as { page?: number; dy?: number };
    } catch {
      return error("invalid request body", 400);
    }
    const page = body.page;
    const dy = body.dy;
    if (!Number.isInteger(page) || (page as number) < 1) return error("invalid page", 400);
    if (typeof dy !== "number" || !Number.isFinite(dy) || Math.abs(dy) > MAX_NUDGE) {
      return error(`dy must be a number within ±${MAX_NUDGE}`, 400);
    }

    const form = await prisma.uploaded_forms.findUnique({
      where: { id },
      select: { status: true },
    });
    if (!form) return error("form not found", 404);
    if (form.status !== "pending_review") return error("form is not pending review", 409);

    const updated = await prisma.$transaction(async (tx) => {
      // GREATEST clamps the bottom edge at 0 on a downward shift; the box height is
      // unchanged so only pos_y moves.
      const n = await tx.$executeRaw`
        UPDATE uploaded_form_fields
        SET pos_y = GREATEST(pos_y + ${dy}::numeric, 0), updated_at = now()
        WHERE form_id = ${id}::uuid AND page_number = ${page}`;
      // A bulk shift invalidates any prior sign-off — clear it (clear-first parity
      // with the per-field drag).
      await tx.uploaded_forms.update({
        where: { id },
        data: { placement_confirmed_at: null, placement_confirmed_by: null },
      });
      return n;
    });

    return json({ page, dy, updated });
  })) as Response;
}
