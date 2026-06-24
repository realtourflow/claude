import { error, json, withAuth } from "@/lib/http";
import { prisma } from "@/lib/db";
import { hasRole } from "@/lib/roles";
import { resolveUserId } from "@/lib/users";
import { getDownloadUrl } from "@/lib/s3";
import { serializeFormField } from "@/lib/uploaded-forms";
import { CORE_KEYS } from "@/lib/form-ai/core-keys";

type Ctx = { params: Promise<{ id: string }> };

// GET /api/admin/forms/:id — full review detail: form + agent + attestation +
// a pre-signed preview URL of the source PDF + every detected field. Admin only.
export async function GET(req: Request, ctx: Ctx): Promise<Response> {
  const { id } = await ctx.params;
  return (await withAuth(req, async (claims): Promise<Response> => {
    if (!hasRole(claims.roles, ["admin"])) return error("forbidden", 403);

    const form = await prisma.uploaded_forms.findUnique({
      where: { id },
      select: {
        id: true,
        label: true,
        side: true,
        status: true,
        source_s3_key: true,
        source_file_name: true,
        attestation_statement: true,
        attested_at: true,
        review_notes: true,
        reviewed_at: true,
        created_at: true,
        docusign_template_id: true,
        users_uploaded_forms_agent_idTousers: {
          select: { name: true, email: true },
        },
      },
    });
    if (!form) return error("form not found", 404);

    const fields = await prisma.uploaded_form_fields.findMany({
      where: { form_id: id },
      orderBy: [{ page_number: "asc" }, { created_at: "asc" }],
    });

    let previewUrl = "";
    try {
      previewUrl = await getDownloadUrl({ key: form.source_s3_key });
    } catch {
      // preview is best-effort; review can still proceed off the field list
    }

    const agent = form.users_uploaded_forms_agent_idTousers;
    return json({
      id: form.id,
      label: form.label,
      side: form.side,
      status: form.status,
      source_file_name: form.source_file_name,
      agent_name: agent?.name ?? "",
      agent_email: agent?.email ?? "",
      attestation_statement: form.attestation_statement,
      attested_at: form.attested_at ? form.attested_at.toISOString() : null,
      review_notes: form.review_notes,
      reviewed_at: form.reviewed_at ? form.reviewed_at.toISOString() : null,
      created_at: form.created_at.toISOString(),
      docusign_template_id: form.docusign_template_id,
      preview_url: previewUrl,
      // The canonical key registry for the review dropdowns (server-sourced so
      // the client never duplicates it).
      core_keys: CORE_KEYS,
      fields: fields.map(serializeFormField),
    });
  })) as Response;
}

type ActionBody = { action?: "approve" | "reject"; review_notes?: string };

// POST /api/admin/forms/:id — the review gate. action=approve assembles the
// field_map from the resolved field decisions and flips the form to `ready`
// (NOT yet sendable — the DocuSign template + resolver land in a later step).
// action=reject marks it rejected. Both require the form to be pending_review.
export async function POST(req: Request, ctx: Ctx): Promise<Response> {
  const { id } = await ctx.params;
  return (await withAuth(req, async (claims): Promise<Response> => {
    if (!hasRole(claims.roles, ["admin"])) return error("forbidden", 403);
    const adminId = await resolveUserId(claims.sub);
    if (!adminId) return error("user not found", 401);

    let body: ActionBody;
    try {
      body = (await req.json()) as ActionBody;
    } catch {
      return error("action is required", 400);
    }
    if (body.action !== "approve" && body.action !== "reject") {
      return error("action must be approve or reject", 400);
    }

    const form = await prisma.uploaded_forms.findUnique({
      where: { id },
      select: { id: true, status: true },
    });
    if (!form) return error("form not found", 404);
    if (form.status !== "pending_review") {
      return error("form is not pending review", 409);
    }

    if (body.action === "reject") {
      await prisma.uploaded_forms.update({
        where: { id },
        data: {
          status: "rejected",
          reviewed_by: adminId,
          reviewed_at: new Date(),
          review_notes: body.review_notes ?? null,
        },
      });
      return json({ id, status: "rejected" });
    }

    // approve — every flagged field must be resolved first.
    const fields = await prisma.uploaded_form_fields.findMany({
      where: { form_id: id },
    });
    const unresolved = fields.filter((f) => f.needs_review).length;
    if (unresolved > 0) {
      return error(
        `resolve all ${unresolved} flagged field(s) before approving`,
        422
      );
    }

    // Assemble the field_map (coreKey -> { label, type, role }) from the
    // effective decision per field. Admin-touched fields use final_*; untouched
    // AI-confident fields use the AI proposal. Only prefillable (text/checkbox)
    // mapped fields make it in — signatures/initials and skips are excluded.
    const fieldMap: Record<string, { label: string; type: string; role?: string }> = {};
    for (const f of fields) {
      const touched = f.decision !== "pending";
      const coreKey = touched ? f.final_core_key : f.ai_core_key;
      if (!coreKey) continue;
      const type = (touched ? f.final_type : f.detected_type) ?? "text";
      if (type !== "text" && type !== "checkbox") continue;
      const role = (touched ? f.final_role : f.ai_role) ?? undefined;
      fieldMap[coreKey] = { label: coreKey, type, ...(role ? { role } : {}) };
    }

    await prisma.uploaded_forms.update({
      where: { id },
      data: {
        status: "ready",
        reviewed_by: adminId,
        reviewed_at: new Date(),
        field_map: fieldMap,
      },
    });
    return json({ id, status: "ready", field_map: fieldMap });
  })) as Response;
}
