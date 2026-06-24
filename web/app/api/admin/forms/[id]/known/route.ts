import { error, json, withAuth } from "@/lib/http";
import { prisma } from "@/lib/db";
import { hasRole } from "@/lib/roles";
import { resolveUserId } from "@/lib/users";
import { getObjectBytes } from "@/lib/s3";
import { PDFDocument } from "pdf-lib";
import { extractAcroFields } from "@/lib/form-ai/extract";
import { computeStructureFingerprint } from "@/lib/form-ai/fingerprint";
import {
  saveKnownForm,
  KnownFormConflictError,
  type KnownField,
} from "@/lib/known-forms";

type Ctx = { params: Promise<{ id: string }> };

// POST /api/admin/forms/:id/known — promote an APPROVED uploaded form into the
// recognition catalog, so future uploads of the same blank are auto-recognized.
// Recomputes the fingerprint from the source bytes (never trusts stored values)
// and snapshots each field's effective (admin-decided) mapping. Admin only.
export async function POST(req: Request, ctx: Ctx): Promise<Response> {
  const { id } = await ctx.params;
  return (await withAuth(req, async (claims): Promise<Response> => {
    if (!hasRole(claims.roles, ["admin"])) return error("forbidden", 403);
    const adminId = await resolveUserId(claims.sub);
    if (!adminId) return error("user not found", 401);

    const form = await prisma.uploaded_forms.findUnique({
      where: { id },
      select: {
        id: true,
        label: true,
        side: true,
        board: true,
        purpose: true,
        status: true,
        source_s3_key: true,
        role_mapping: true,
      },
    });
    if (!form) return error("form not found", 404);
    if (form.status !== "ready") {
      return error("only an approved (ready) form can be saved as known", 409);
    }

    const fieldRows = await prisma.uploaded_form_fields.findMany({
      where: { form_id: id },
      orderBy: [{ page_number: "asc" }, { created_at: "asc" }],
    });

    // Recompute the fingerprint from the source bytes so it matches what
    // recognition will hash on a future upload of the same blank.
    let fingerprint: string;
    let fieldCount: number;
    let pageCount: number;
    try {
      const bytes = await getObjectBytes(form.source_s3_key);
      const detected = await extractAcroFields(bytes);
      pageCount = (
        await PDFDocument.load(bytes, { ignoreEncryption: true })
      ).getPageCount();
      const fp = computeStructureFingerprint(detected, pageCount);
      fingerprint = fp.fingerprint;
      fieldCount = fp.fieldCount;
    } catch (err) {
      return error(
        "could not read the source PDF: " +
          (err instanceof Error ? err.message : String(err)),
        400
      );
    }

    const num = (v: unknown) => (v === null || v === undefined ? 0 : Number(v));
    // Snapshot each field's effective decision into the catalog answer key.
    // core_key, role, AND type are all captured as the admin's effective value
    // (final_* when touched) — mirrors effective() in uploaded-forms.ts so a
    // recognized re-upload reproduces the exact template the admin approved.
    const fields: KnownField[] = fieldRows.map((f) => {
      const touched = f.decision !== "pending";
      const coreKey = touched ? f.final_core_key : f.ai_core_key;
      const role = (touched ? f.final_role : f.ai_role) ?? null;
      const effectiveType = (touched ? f.final_type : f.detected_type) ?? f.detected_type;
      return {
        detected_name: f.detected_name,
        detected_type: f.detected_type,
        effective_type: effectiveType,
        page_number: f.page_number,
        pos_x: num(f.pos_x),
        pos_y: num(f.pos_y),
        width: num(f.width),
        height: num(f.height),
        core_key: coreKey,
        role,
        // Unmapped fields stay flagged so future uploads re-route them to review.
        needs_review: !coreKey,
      };
    });

    try {
      const saved = await saveKnownForm({
        label: form.label,
        side: form.side,
        board: form.board,
        purpose: form.purpose,
        fingerprint,
        fieldCount,
        pageCount,
        fields,
        roleMapping: (form.role_mapping ?? {}) as Record<string, string>,
        sourceFormId: id,
        createdBy: adminId,
      });
      return json(
        { known_form_id: saved.id, fingerprint, field_count: fieldCount },
        201
      );
    } catch (err) {
      if (err instanceof KnownFormConflictError) return error(err.message, 409);
      throw err;
    }
  })) as Response;
}
