import { error, json, withAuth } from "@/lib/http";
import { prisma } from "@/lib/db";
import { hasRole } from "@/lib/roles";
import { isCoreKey } from "@/lib/form-ai/core-keys";
import { serializeFormField } from "@/lib/uploaded-forms";

type Ctx = { params: Promise<{ id: string }> };

const TYPES = ["text", "checkbox", "signature", "initial", "date"];
const MAX_PAGE = 50;
const isNonNegNum = (v: unknown) => typeof v === "number" && Number.isFinite(v) && v >= 0;

type AddBody = {
  detected_name?: string;
  detected_type?: string;
  page_number?: number;
  // Initial box (PDF points, bottom-left origin) — the admin drags it onto the
  // blank afterward. Defaults to 0 if the client doesn't pre-place it.
  pos_x?: number;
  pos_y?: number;
  width?: number;
  height?: number;
  final_core_key?: string | null;
  final_role?: string | null;
};

// POST /api/admin/forms/:id/fields — the admin ADDS a field vision missed entirely
// (picked from the document type's master list, or a custom one) during placement
// review, then drags it onto its blank. A new box changes placement, so it CLEARS
// the form's placement confirmation — re-arming the mandatory gate exactly like
// moving a box does. Only while pending_review. Admin only.
export async function POST(req: Request, ctx: Ctx): Promise<Response> {
  const { id } = await ctx.params;
  return (await withAuth(req, async (claims): Promise<Response> => {
    if (!hasRole(claims.roles, ["admin"])) return error("forbidden", 403);

    let body: AddBody;
    try {
      body = (await req.json()) as AddBody;
    } catch {
      return error("invalid request body", 400);
    }

    const name = (body.detected_name ?? "").trim();
    if (!name) return error("detected_name is required", 400);
    const type = body.detected_type ?? "text";
    if (!TYPES.includes(type)) return error("invalid field type", 400);
    const page = body.page_number ?? 1;
    if (!Number.isInteger(page) || page < 1 || page > MAX_PAGE) {
      return error("invalid page_number", 400);
    }
    for (const k of ["pos_x", "pos_y", "width", "height"] as const) {
      if (body[k] !== undefined && !isNonNegNum(body[k])) {
        return error(`${k} must be a non-negative number`, 400);
      }
    }
    if (
      body.final_core_key != null &&
      body.final_core_key !== "" &&
      !isCoreKey(body.final_core_key)
    ) {
      return error(`unknown core key "${body.final_core_key}"`, 400);
    }

    const form = await prisma.uploaded_forms.findUnique({
      where: { id },
      select: { status: true },
    });
    if (!form) return error("form not found", 404);
    if (form.status !== "pending_review") {
      return error("form is not pending review", 409);
    }

    const created = await prisma.$transaction(async (tx) => {
      // Re-arm the placement gate FIRST — a confirmation can never outlive a box
      // that wasn't part of it.
      await tx.uploaded_forms.update({
        where: { id },
        data: { placement_confirmed_at: null, placement_confirmed_by: null },
      });
      return tx.uploaded_form_fields.create({
        data: {
          form_id: id,
          detected_name: name,
          detected_type: type,
          page_number: page,
          pos_x: body.pos_x ?? 0,
          pos_y: body.pos_y ?? 0,
          width: body.width ?? 0,
          height: body.height ?? 0,
          nearby_text: "",
          ai_core_key: null,
          ai_role: null,
          ai_confidence: null,
          ai_rationale: "manually added by admin in placement review",
          needs_review: false,
          final_core_key: body.final_core_key ? body.final_core_key : null,
          final_role: body.final_role ? body.final_role : null,
          final_type: type,
          decision: "accepted",
        },
      });
    });

    return json(serializeFormField(created), 201);
  })) as Response;
}
