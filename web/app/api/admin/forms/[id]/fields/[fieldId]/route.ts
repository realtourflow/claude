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
  // Overlay drag: corrected position (PDF points, bottom-left origin).
  pos_x?: number;
  pos_y?: number;
  width?: number;
  height?: number;
};

const POS_KEYS = ["pos_x", "pos_y", "width", "height"] as const;
const isNonNegNum = (v: unknown) => typeof v === "number" && Number.isFinite(v) && v >= 0;

// PATCH /api/admin/forms/:id/fields/:fieldId — the admin corrects one detected
// field during review: its mapping (core_key/role/type/decision) and/or its
// POSITION (dragged in the overlay). Any non-pending decision resolves
// needs_review. A position edit CLEARS the form's placement confirmation so the
// gate always reflects the current boxes. Only while pending_review. Admin only.
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
    for (const k of POS_KEYS) {
      if (body[k] !== undefined && !isNonNegNum(body[k])) {
        return error(`${k} must be a non-negative number`, 400);
      }
    }

    const hasMapping =
      body.decision !== undefined ||
      body.final_core_key !== undefined ||
      body.final_role !== undefined ||
      body.final_type !== undefined;
    const hasPosition = POS_KEYS.some((k) => body[k] !== undefined);
    if (!hasMapping && !hasPosition) return error("nothing to update", 400);

    const field = await prisma.uploaded_form_fields.findFirst({
      where: { id: fieldId, form_id: id },
      select: { id: true, uploaded_forms: { select: { status: true } } },
    });
    if (!field) return error("field not found", 404);
    if (field.uploaded_forms.status !== "pending_review") {
      return error("form is not pending review", 409);
    }

    const data: Record<string, unknown> = { updated_at: new Date() };
    if (hasMapping) {
      const decision = body.decision ?? "corrected";
      data.decision = decision;
      // Any real decision (accepted/corrected/skipped) clears the review flag.
      data.needs_review = decision === "pending";
      if (body.final_core_key !== undefined) {
        data.final_core_key = body.final_core_key === "" ? null : body.final_core_key;
      }
      if (body.final_role !== undefined) {
        data.final_role = body.final_role === "" ? null : body.final_role;
      }
      if (body.final_type !== undefined) data.final_type = body.final_type;
    }
    if (hasPosition) {
      for (const k of POS_KEYS) if (body[k] !== undefined) data[k] = body[k];
    }

    const updated = await prisma.$transaction(async (tx) => {
      // Moving a box invalidates a prior placement sign-off — clear it FIRST so a
      // confirmation can never outlive the positions it attested to.
      if (hasPosition) {
        await tx.uploaded_forms.update({
          where: { id },
          data: { placement_confirmed_at: null, placement_confirmed_by: null },
        });
      }
      return tx.uploaded_form_fields.update({ where: { id: fieldId }, data });
    });

    return json(serializeFormField(updated));
  })) as Response;
}
