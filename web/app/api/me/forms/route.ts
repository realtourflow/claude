import { error, json, withAuth } from "@/lib/http";
import { prisma } from "@/lib/db";
import { resolveUserId } from "@/lib/users";
import { getObjectBytes, deleteObject } from "@/lib/s3";
import { extractAcroFields } from "@/lib/form-ai/extract";
import { PDFDocument } from "pdf-lib";
import {
  matchKnownForm,
  matchFlatKnownForm,
  matchTextLayoutKnownForm,
  TEXT_LAYOUT_MATCH_THRESHOLD,
  copyKnownFields,
  type KnownFormRow,
} from "@/lib/known-forms";
import { extractPdfText } from "@/lib/pdf-text";
import { computeTextFingerprint } from "@/lib/text-layout";
import {
  FORM_SIDES,
  type FormSide,
  getAttestationStatement,
  runFieldPipeline,
  sha256Hex,
} from "@/lib/uploaded-forms";

type FormListRow = {
  id: string;
  label: string;
  side: string;
  status: string;
  source_file_name: string;
  created_at: Date;
  field_count: number;
  needs_review_count: number;
};

function serializeListRow(r: FormListRow) {
  return {
    id: r.id,
    label: r.label,
    side: r.side,
    status: r.status,
    source_file_name: r.source_file_name,
    created_at: r.created_at.toISOString(),
    field_count: Number(r.field_count),
    needs_review_count: Number(r.needs_review_count),
  };
}

// GET /api/me/forms — the caller's uploaded forms with field counts.
export async function GET(req: Request): Promise<Response> {
  return (await withAuth(
    req,
    async (claims): Promise<Response> => {
      const userId = await resolveUserId(claims.sub);
      if (!userId) return error("user not found", 404);

      const rows = await prisma.$queryRaw<FormListRow[]>`
        SELECT f.id, f.label, f.side, f.status, f.source_file_name, f.created_at,
               COUNT(ff.id)::int AS field_count,
               COUNT(ff.id) FILTER (WHERE ff.needs_review)::int AS needs_review_count
        FROM uploaded_forms f
        LEFT JOIN uploaded_form_fields ff ON ff.form_id = f.id
        WHERE f.agent_id = ${userId}::uuid
        GROUP BY f.id
        ORDER BY f.created_at DESC
      `;
      return json(rows.map(serializeListRow));
    },
    { allowedRoles: ["agent", "admin"] }
  )) as Response;
}

type CreateBody = {
  label?: string;
  side?: string;
  file_name?: string;
  s3_key?: string;
  mime_type?: string;
  attestation?: boolean;
};

// POST /api/me/forms — confirm an uploaded blank form. Requires the licensing
// attestation, snapshots its wording, and runs the detect→map pipeline. The
// form lands in pending_review — unusable on a deal until an admin approves it.
export async function POST(req: Request): Promise<Response> {
  return (await withAuth(
    req,
    async (claims): Promise<Response> => {
      const userId = await resolveUserId(claims.sub);
      if (!userId) return error("user not found", 404);

      let body: CreateBody;
      try {
        body = (await req.json()) as CreateBody;
      } catch {
        return error("invalid request body", 400);
      }

      const label = (body.label ?? "").trim();
      const side = body.side as FormSide;
      if (!label) return error("label is required", 400);
      if (!FORM_SIDES.includes(side)) {
        return error("side must be buy, sell, or both", 400);
      }
      if (!body.s3_key) return error("s3_key is required", 400);
      // Confine the key to the caller's own namespace (cross-agent guard).
      if (!body.s3_key.startsWith(`agent-forms/${userId}/`)) {
        return error("s3_key is not in your namespace", 400);
      }
      if (body.attestation !== true) {
        return error(
          "you must attest you are licensed and permitted to use and host this form",
          400
        );
      }

      // Pull the uploaded bytes to hash, size, and detect fields.
      let bytes: Uint8Array;
      try {
        bytes = await getObjectBytes(body.s3_key);
      } catch {
        return error("uploaded file not found", 400);
      }

      const fields = await extractAcroFields(bytes);

      const statement = await getAttestationStatement();
      const agentUser = await prisma.users.findUnique({
        where: { id: userId },
        select: { market: true },
      });
      const agentMarket = agentUser?.market ?? "";

      // Recognition (Layer 1): consult the known-forms catalog FIRST. FILLABLE
      // PDFs match by AcroForm structure. FLAT PDFs (no fields) match by exact
      // CONTENT HASH and then, if that misses, by TEXT-LAYOUT similarity — so a
      // re-saved / re-exported same-layout copy (different bytes) still matches a
      // known form (e.g. the seeded FORM 300) and gets its exact placement, no
      // vision. A hit pre-fills the verified field map and skips the AI mapper.
      // Best-effort: errors fall through and never 500. Never auto-approves.
      let fingerprint = "";
      let known: KnownFormRow | null = null;
      try {
        if (fields.length === 0) {
          const r = await matchFlatKnownForm({ bytes, market: agentMarket });
          fingerprint = r.fingerprint;
          known = r.known;
          if (!known) {
            // Content hash missed → text similarity. pdfjs runs on Vercel (no poppler).
            const tf = computeTextFingerprint(await extractPdfText(bytes));
            const t = await matchTextLayoutKnownForm({
              fingerprint: tf,
              market: agentMarket,
              threshold: TEXT_LAYOUT_MATCH_THRESHOLD,
            });
            known = t.best;
          }
        } else {
          const pageCount = (
            await PDFDocument.load(bytes, { ignoreEncryption: true })
          ).getPageCount();
          const r = await matchKnownForm({ fields, pageCount, market: agentMarket });
          fingerprint = r.fingerprint;
          known = r.known;
        }
      } catch (err) {
        console.error("form recognition failed; using AI pipeline", err);
      }

      // A FLAT upload we don't recognize has no AcroForm fields to map. The
      // vision path — which would DETECT field boxes here and feed
      // runFieldPipeline — is built (lib/form-ai/vision.ts) but NOT wired yet,
      // pending its accuracy review. Until then, reject flat unknowns.
      // TODO(vision): replace this 422 with the vision detector once approved.
      if (fields.length === 0 && !known) {
        await deleteObject(body.s3_key);
        return error(
          "this PDF has no fillable fields and isn't a recognized form yet — automatic flat-form detection is coming soon",
          422
        );
      }

      const form = await prisma.uploaded_forms.create({
        data: {
          agent_id: userId,
          label,
          side,
          // A recognized form inherits the catalog's market; otherwise default to
          // the agent's market (recorded from day one to avoid a backfill).
          board: known?.board ?? agentMarket,
          source_s3_key: body.s3_key,
          source_file_name: body.file_name ?? "",
          mime_type: body.mime_type ?? "application/pdf",
          file_size: bytes.length,
          file_sha256: sha256Hex(bytes),
          structure_sha256: fingerprint,
          recognized_from_known_form_id: known?.id ?? null,
          attested_by: userId,
          attestation_statement: statement,
          ...(known?.role_mapping
            ? { role_mapping: known.role_mapping as object }
            : {}),
        },
        select: {
          id: true,
          label: true,
          side: true,
          status: true,
          source_file_name: true,
          created_at: true,
        },
      });

      // Recognized → copy the verified field map (no AI call). Else AI pipeline.
      // A copy failure falls back to the pipeline so the upload never 500s.
      let counts: { fieldCount: number; needsReviewCount: number };
      if (known) {
        try {
          counts = await copyKnownFields(form.id, known);
        } catch (err) {
          console.error("copyKnownFields failed; using AI pipeline", err);
          counts = await runFieldPipeline({ formId: form.id, side, fields });
        }
      } else {
        counts = await runFieldPipeline({ formId: form.id, side, fields });
      }

      return json(
        {
          id: form.id,
          label: form.label,
          side: form.side,
          status: form.status,
          source_file_name: form.source_file_name,
          created_at: form.created_at.toISOString(),
          field_count: counts.fieldCount,
          needs_review_count: counts.needsReviewCount,
        },
        201
      );
    },
    { allowedRoles: ["agent", "admin"] }
  )) as Response;
}
