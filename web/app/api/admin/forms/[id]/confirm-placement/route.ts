import { error, json, withAuth } from "@/lib/http";
import { prisma } from "@/lib/db";
import { hasRole } from "@/lib/roles";
import { resolveUserId } from "@/lib/users";

type Ctx = { params: Promise<{ id: string }> };

// POST /api/admin/forms/:id/confirm-placement — the human attests, in the visual
// overlay, that every detected field box sits on the correct blank. This is the
// MANDATORY gate for vision-detected forms: the approve route refuses them until
// this is set (and approve is the only path to a sendable 'ready' form). Editing
// any field position afterward clears this, forcing a re-confirm.
export async function POST(req: Request, ctx: Ctx): Promise<Response> {
  const { id } = await ctx.params;
  return (await withAuth(req, async (claims): Promise<Response> => {
    if (!hasRole(claims.roles, ["admin"])) return error("forbidden", 403);
    const adminId = await resolveUserId(claims.sub);
    if (!adminId) return error("user not found", 401);

    const form = await prisma.uploaded_forms.findUnique({
      where: { id },
      select: { id: true, status: true },
    });
    if (!form) return error("form not found", 404);
    // Confirmation only makes sense pre-approval (it gates the approve step).
    if (form.status !== "pending_review") {
      return error("form is not pending review", 409);
    }

    const confirmedAt = new Date();
    await prisma.uploaded_forms.update({
      where: { id },
      data: { placement_confirmed_at: confirmedAt, placement_confirmed_by: adminId },
    });
    return json({ id, placement_confirmed_at: confirmedAt.toISOString() });
  })) as Response;
}
