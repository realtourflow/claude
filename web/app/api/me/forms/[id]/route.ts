import { error, json, withAuth } from "@/lib/http";
import { prisma } from "@/lib/db";
import { resolveUserId } from "@/lib/users";

type Ctx = { params: Promise<{ id: string }> };

// GET /api/me/forms/:id — one of the caller's uploaded forms plus its detected
// fields + AI proposals. Read-only for the agent (the admin gate owns edits).
export async function GET(req: Request, ctx: Ctx): Promise<Response> {
  const { id } = await ctx.params;
  return (await withAuth(
    req,
    async (claims): Promise<Response> => {
      const userId = await resolveUserId(claims.sub);
      if (!userId) return error("user not found", 404);

      const form = await prisma.uploaded_forms.findFirst({
        where: { id, agent_id: userId },
        select: {
          id: true,
          label: true,
          side: true,
          status: true,
          source_file_name: true,
          review_notes: true,
          reviewed_at: true,
          created_at: true,
        },
      });
      if (!form) return error("form not found", 404);

      const fields = await prisma.uploaded_form_fields.findMany({
        where: { form_id: id },
        orderBy: [{ page_number: "asc" }, { created_at: "asc" }],
        select: {
          id: true,
          detected_name: true,
          detected_type: true,
          page_number: true,
          ai_core_key: true,
          ai_role: true,
          ai_confidence: true,
          ai_rationale: true,
          needs_review: true,
          final_core_key: true,
          final_role: true,
          decision: true,
        },
      });

      return json({
        id: form.id,
        label: form.label,
        side: form.side,
        status: form.status,
        source_file_name: form.source_file_name,
        review_notes: form.review_notes,
        reviewed_at: form.reviewed_at ? form.reviewed_at.toISOString() : null,
        created_at: form.created_at.toISOString(),
        fields: fields.map((f) => ({
          id: f.id,
          detected_name: f.detected_name,
          detected_type: f.detected_type,
          page_number: f.page_number,
          ai_core_key: f.ai_core_key,
          ai_role: f.ai_role,
          ai_confidence: f.ai_confidence === null ? null : Number(f.ai_confidence),
          ai_rationale: f.ai_rationale,
          needs_review: f.needs_review,
          final_core_key: f.final_core_key,
          final_role: f.final_role,
          decision: f.decision,
        })),
      });
    },
    { allowedRoles: ["agent", "admin"] }
  )) as Response;
}
