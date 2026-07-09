import { error, json, withAuth } from "@/lib/http";
import { prisma } from "@/lib/db";
import { hasRole } from "@/lib/roles";
import { resolveUserId } from "@/lib/users";
import { getDownloadUrl, getObjectBytes } from "@/lib/s3";
import { getDocusignClient } from "@/lib/docusign";
import { PDFDocument } from "pdf-lib";
import {
  serializeFormField,
  deriveSigners,
  buildTemplateSigners,
  type FormSide,
  type SignersConfig,
} from "@/lib/uploaded-forms";
import { CORE_KEYS } from "@/lib/form-ai/core-keys";
import { rememberApprovedForm } from "@/lib/remember-form";
import { KnownFormConflictError } from "@/lib/known-forms";
import { isValidMarket } from "@/lib/markets";

type Ctx = { params: Promise<{ id: string }> };

// GET /api/admin/forms/:id — full review detail: form + agent + attestation +
// a pre-signed preview URL of the source PDF + every detected field + the
// derived signer config (the "derive" half of derive-then-confirm). Admin only.
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
        detection_source: true,
        placement_confirmed_at: true,
        form_promotions: {
          select: { id: true, brokerage: true, market: true },
          orderBy: [{ brokerage: "asc" }, { market: "asc" }],
        },
        form_type_id: true,
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

    // The declared type's field set = the master list of placeable fields for this
    // document type. Drives the overlay's tier colors (core/common) AND the "add a
    // field vision missed" picker (label/type/role/tier/core_key). Best-effort.
    const tierByLabel = new Map<string, string>();
    type TypeFieldOption = {
      label: string;
      type: string;
      role: string;
      tier: string;
      core_key: string | null;
      required: boolean;
    };
    let typeFields: TypeFieldOption[] = [];
    if (form.form_type_id) {
      const type = await prisma.form_types.findUnique({
        where: { id: form.form_type_id },
        select: { field_set: true },
      });
      const set = (Array.isArray(type?.field_set) ? type!.field_set : []) as Array<{
        label?: string;
        type?: string;
        role?: string;
        tier?: string;
        core_key?: string | null;
        required?: boolean;
      }>;
      typeFields = set
        .filter((f): f is typeof f & { label: string } => !!f.label)
        .map((f) => ({
          label: f.label,
          type: f.type ?? "text",
          role: f.role ?? "",
          tier: f.tier ?? "common",
          core_key: f.core_key ?? null,
          required: !!f.required,
        }));
      for (const f of typeFields) tierByLabel.set(f.label, f.tier);
    }

    let previewUrl = "";
    // Page sizes (PDF points) let the overlay convert a field's pos_x/pos_y/width/
    // height into a fraction of the rendered page image. Best-effort, like preview.
    let pages: Array<{ page: number; width: number; height: number }> = [];
    try {
      previewUrl = await getDownloadUrl({ key: form.source_s3_key });
    } catch {
      // preview is best-effort; review can still proceed off the field list
    }
    try {
      const doc = await PDFDocument.load(await getObjectBytes(form.source_s3_key), {
        ignoreEncryption: true,
      });
      pages = doc.getPages().map((p, i) => ({
        page: i + 1,
        width: Math.round(p.getWidth()),
        height: Math.round(p.getHeight()),
      }));
    } catch {
      // sizes are best-effort; the overlay falls back to letter (612×792)
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
      detection_source: form.detection_source,
      placement_confirmed_at: form.placement_confirmed_at
        ? form.placement_confirmed_at.toISOString()
        : null,
      promotions: form.form_promotions,
      preview_url: previewUrl,
      pages,
      core_keys: CORE_KEYS,
      // Master list of placeable fields for this document type — feeds the overlay's
      // "add a missing field" picker.
      type_fields: typeFields,
      // Derived signers (admin confirms/edits, then passes back on approve).
      derived_signers: deriveSigners(fields, form.side as FormSide),
      fields: fields.map((f) => ({
        ...serializeFormField(f),
        tier: tierByLabel.get(f.detected_name) ?? "common",
      })),
    });
  })) as Response;
}

type SignersOverride = {
  role_mapping?: Record<string, string>;
  routing?: string;
  consumer_roles?: string[];
};
type ActionBody = {
  action?: "approve" | "reject" | "promote" | "unpromote";
  review_notes?: string;
  signers?: SignersOverride;
  // promote/unpromote: the company + market combo(s). ALWAYS both together — a
  // promotion is never company-only or market-only. `markets` promotes the same
  // company across several markets in one call (each stored as its own combo);
  // `market` is the single-market form of the same thing.
  brokerage?: string;
  market?: string;
  markets?: string[];
};

// POST /api/admin/forms/:id — the review gate. action=approve resolves the
// signers (your confirmed config, else the derived default), assembles the
// field_map, creates the DocuSign template (tabs placed at the detected field
// coordinates), stores the template id + send-config, and flips to `ready` —
// at which point the form is genuinely sendable. action=reject records a reason.
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
    // Promote / unpromote — share an already-APPROVED form with every agent whose
    // profile matches a COMPANY + MARKET combo (both together, always). Matching
    // is computed live from agent profiles, so agents who onboard later with the
    // same company + market get the form automatically. A separate admin lever
    // from approve: approve makes the form usable by its owning agent only.
    if (body.action === "promote" || body.action === "unpromote") {
      const brokerage = (body.brokerage ?? "").trim();
      // One market or SEVERAL at once (a form is often good in multiple markets —
      // the UI can tick many, or all). Each stored promotion row is still one
      // company + one market combo; visibility matching is unchanged.
      const markets = [
        ...new Set(
          (body.markets ?? (body.market ? [body.market] : []))
            .filter((m): m is string => typeof m === "string")
            .map((m) => m.trim())
            .filter(Boolean)
        ),
      ];
      if (!brokerage || markets.length === 0) {
        return error("a promotion needs both a company and at least one market", 400);
      }
      const badMarket = markets.find((m) => !isValidMarket(m));
      if (badMarket !== undefined) return error(`unknown market: ${badMarket}`, 400);

      const target = await prisma.uploaded_forms.findUnique({
        where: { id },
        select: { status: true },
      });
      if (!target) return error("form not found", 404);
      if (target.status !== "ready") {
        return error("only approved forms can be promoted", 409);
      }

      if (body.action === "promote") {
        // Promotions target a company from the managed list (active only).
        const known = await prisma.brokerages.findFirst({
          where: { name: brokerage, status: "active" },
          select: { id: true },
        });
        if (!known) return error("unknown company — add it to the list first", 400);
        // Idempotent: re-promoting an existing combo is a no-op.
        await prisma.form_promotions.createMany({
          data: markets.map((market) => ({
            form_id: id,
            brokerage,
            market,
            created_by: adminId,
          })),
          skipDuplicates: true,
        });
      } else {
        await prisma.form_promotions.deleteMany({
          where: { form_id: id, brokerage, market: { in: markets } },
        });
      }

      const promotions = await prisma.form_promotions.findMany({
        where: { form_id: id },
        select: { id: true, brokerage: true, market: true },
        orderBy: [{ brokerage: "asc" }, { market: "asc" }],
      });
      return json({ id, promotions });
    }

    if (body.action !== "approve" && body.action !== "reject") {
      return error("action must be approve, reject, or promote", 400);
    }

    const form = await prisma.uploaded_forms.findUnique({
      where: { id },
      select: {
        id: true,
        status: true,
        label: true,
        side: true,
        source_s3_key: true,
        source_file_name: true,
        detection_source: true,
        placement_confirmed_at: true,
      },
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

    // MANDATORY placement gate (max-safety). A form whose positions are not exact
    // native field rects must have its placement confirmed in the overlay by THIS
    // reviewer before it can become sendable:
    //   - 'vision'      — AI-guessed positions.
    //   - 'recognized'  — inherited from a remembered layout (a PRIOR reviewer's
    //                     placement, applied to this agent's copy). We re-confirm so
    //                     a first-review mistake can't propagate silently onto a
    //                     legal contract.
    // 'acroform' is exempt (the PDF itself defines the field positions). This is the
    // unskippable chokepoint — approve is the only path to status='ready' (see
    // lib/agent-forms.visibilityWhere). No bypass.
    if (
      (form.detection_source === "vision" || form.detection_source === "recognized") &&
      !form.placement_confirmed_at
    ) {
      return error(
        "confirm field placement in the overlay review before approving this form",
        422
      );
    }

    const docusign = getDocusignClient();
    if (!docusign.enabled() || !docusign.createTemplateFromDocument) {
      return error("DocuSign is not configured for template creation", 503);
    }

    // Signers: the admin's confirmed config, else the derived default.
    const o = body.signers;
    const signers: SignersConfig =
      o && o.role_mapping
        ? {
            roleMapping: o.role_mapping,
            routing: o.routing === "consumers" ? "consumers" : "by-role",
            consumerRoles: o.consumer_roles ?? [],
          }
        : deriveSigners(fields, form.side as FormSide);

    // Assemble the prefill field_map from the effective decision per field.
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

    // Create the DocuSign template from the PDF with tabs at the field coords.
    let templateId: string;
    try {
      const bytes = await getObjectBytes(form.source_s3_key);
      const templateSigners = await buildTemplateSigners({
        pdfBytes: bytes,
        fields,
        roleMapping: signers.roleMapping,
        side: form.side as FormSide,
      });
      templateId = await docusign.createTemplateFromDocument({
        name: `${form.label} — ${form.id}`,
        documentName: form.source_file_name || "form.pdf",
        documentBytes: bytes,
        signers: templateSigners,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return error("failed to create DocuSign template: " + msg, 502);
    }

    await prisma.uploaded_forms.update({
      where: { id },
      data: {
        status: "ready",
        reviewed_by: adminId,
        reviewed_at: new Date(),
        field_map: fieldMap,
        role_mapping: signers.roleMapping,
        routing: signers.routing,
        consumer_roles: signers.consumerRoles,
        docusign_template_id: templateId,
      },
    });

    // Phase 4: a reviewed VISION form is now remembered as a known layout, so the
    // next agent who uploads the same form is recognized (no vision) and inherits
    // this reviewed placement. Best-effort — a failure, or "already remembered",
    // must never undo the approval that already succeeded above.
    if (form.detection_source === "vision") {
      try {
        await rememberApprovedForm(id, adminId);
      } catch (err) {
        if (!(err instanceof KnownFormConflictError)) {
          console.error("remember-as-known failed; form stays approved", err);
        }
      }
    }

    return json({
      id,
      status: "ready",
      field_map: fieldMap,
      role_mapping: signers.roleMapping,
      docusign_template_id: templateId,
    });
  })) as Response;
}
