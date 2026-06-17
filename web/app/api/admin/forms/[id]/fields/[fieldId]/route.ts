import { error, json, withAuth } from "@/lib/http";
import { prisma } from "@/lib/db";
import { hasRole } from "@/lib/roles";
import { isCoreKey } from "@/lib/form-ai/core-keys";
import { serializeFormField } from "@/lib/uploaded-forms";

type Ctx = { params: Promise<{ id: string; fieldId: string }> };

const DECISIONS = ["pending", "accepted", "corrected", "skipped"];
const TYPES = ["text", "checkbox", "signature", "initial", "date"];

type PatchBody = {
  final_core_key?: string | null;
  final_role?: string | null;
  final_type?: string;
  decision?: string;
};

// PATCH /api/admin/forms/:id/fields/:fieldId — the admin corrects one detected
// field's mapping during review. Any non-pending decision resolves needs_review.
// Only allowed while the parent form is still pending_review. Admin only.
export async function PATCH(req: Request, ctx: Ctx): Promise<Response> {
  const { id, fieldId } = await ctx.params;
  return (await withAuth(req, async (claims): Promise<Response> => {
    if (!hasRole(claims.roles, ["admin"])) return error("forbidden", 403);

    let body: PatchBody;
    try {
      body = (await req.json()) as PatchBody;
    } catch {
      return error("invalid request body", 400);
    }

    if (
      body.final_core_key != null &&
      body.final_core_key !== "" &&
      !isCoreKey(body.final_core_key)
    ) {
      return error(`unknown core key "${body.final_core_key}"`, 400);
    }
    if (body.decision != null && !DECISIONS.includes(body.decision)) {
      return error("invalid decision", 400);
    }
    if (body.final_type != null && !TYPES.includes(body.final_type)) {
      return error("invalid field type", 400);
    }

    const field = await prisma.uploaded_form_fields.findFirst({
      where: { id: fieldId, form_id: id },
      select: { id: true, uploaded_forms: { select: { status: true } } },
    });
    if (!field) return error("field not found", 404);
    if (field.uploaded_forms.status !== "pending_review") {
      return error("form is not pending review", 409);
    }

    const decision = body.decision ?? "corrected";

    const updated = await prisma.uploaded_form_fields.update({
      where: { id: fieldId },
      data: {
        decision,
        // Any real decision (accepted/corrected/skipped) clears the review flag.
        needs_review: decision === "pending",
        updated_at: new Date(),
        ...(body.final_core_key !== undefined
          ? { final_core_key: body.final_core_key === "" ? null : body.final_core_key }
          : {}),
        ...(body.final_role !== undefined
          ? { final_role: body.final_role === "" ? null : body.final_role }
          : {}),
        ...(body.final_type !== undefined ? { final_type: body.final_type } : {}),
      },
    });

    return json(serializeFormField(updated));
  })) as Response;
}
