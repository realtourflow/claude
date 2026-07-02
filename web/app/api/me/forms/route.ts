import { error, json, withAuth } from "@/lib/http";
import { prisma } from "@/lib/db";
import { resolveUserId } from "@/lib/users";
import { getObjectBytes, getObjectSize, deleteObject } from "@/lib/s3";
import {
  FORM_SIDES,
  type FormSide,
  getAttestationStatement,
  sha256Hex,
} from "@/lib/uploaded-forms";
import {
  createUploadedForm,
  FormTypeRequiredError,
  FormDetectEnqueueError,
} from "@/lib/create-uploaded-form";
import { sendNotificationEmail } from "@/lib/email";

const ADMIN_NOTIFY_EMAIL = "paul@mountain.mortgage";

// Best-effort: tell the admin an agent uploaded a form that needs Vision
// field-placement review. A delivery failure must never fail the upload.
async function notifyAdminOfFormUpload(opts: {
  origin: string;
  agentName: string;
  agentEmail: string;
  label: string;
}): Promise<void> {
  try {
    await sendNotificationEmail({
      to: ADMIN_NOTIFY_EMAIL,
      subject: `New form to review from ${opts.agentName}`,
      heading: "An agent uploaded a form for review",
      body: `${opts.agentName} (${opts.agentEmail}) uploaded "${opts.label}" for review. Open Admin → Form Review to place the fields and approve it.`,
      dealUrl: `${opts.origin}/admin/forms`,
    });
  } catch (err) {
    console.error("failed to send admin form-upload notification", err);
  }
}

// Bound the work this route does on untrusted upload bytes (it loads them into
// pdf-lib AND pdfjs). Cap the function time and reject an oversized object before
// buffering/parsing it — a legit blank form is well under this.
export const maxDuration = 60;
const MAX_UPLOAD_BYTES = 25 * 1024 * 1024; // 25 MB

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
  // The document type the agent declared ("this is my purchase agreement"). Its
  // key in form_types; selects the field set guided vision will locate (Phase 3).
  form_type?: string;
  // True when this is ONE combined PDF holding several forms — the admin splits it
  // into individual forms by page range in Form Review (no field detection here).
  bundle?: boolean;
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

      // The agent's declared document type (optional today; required by the UI).
      // Resolve its id and reject an unknown/inactive key — this selects the field
      // set guided vision will locate on the agent's layout (Phase 3).
      let formTypeId: string | null = null;
      if (body.form_type) {
        const t = await prisma.form_types.findUnique({
          where: { key: body.form_type },
          select: { id: true, active: true },
        });
        if (!t || !t.active) return error("unknown form type", 400);
        formTypeId = t.id;
      }

      // Reject an oversized object FIRST (cheap HeadObject), before buffering or
      // parsing it — a malicious huge/nested PDF must not OOM or time out the fn.
      let size: number;
      try {
        size = await getObjectSize(body.s3_key);
      } catch {
        return error("uploaded file not found", 400);
      }
      if (size > MAX_UPLOAD_BYTES) {
        await deleteObject(body.s3_key);
        return error(
          `file too large — max ${MAX_UPLOAD_BYTES / (1024 * 1024)}MB`,
          413
        );
      }

      // Pull the uploaded bytes to hash, size, and detect fields.
      let bytes: Uint8Array;
      try {
        bytes = await getObjectBytes(body.s3_key);
      } catch {
        return error("uploaded file not found", 400);
      }

      const agentUser = await prisma.users.findUnique({
        where: { id: userId },
        select: { market: true, name: true, email: true },
      });
      const agentMarket = agentUser?.market ?? "";
      const agentName = agentUser?.name || agentUser?.email || "An agent";
      const agentEmail = agentUser?.email ?? "";
      const origin = new URL(req.url).origin;

      // BUNDLE: one combined PDF (e.g. "all buyer docs"). We do NOT detect fields —
      // the admin carves it into individual forms by page range in Form Review.
      if (body.bundle === true) {
        const statement = await getAttestationStatement();
        const bundle = await prisma.uploaded_forms.create({
          data: {
            agent_id: userId,
            label,
            side,
            board: agentMarket,
            source_s3_key: body.s3_key,
            source_file_name: body.file_name ?? "",
            mime_type: body.mime_type ?? "application/pdf",
            file_size: bytes.length,
            file_sha256: sha256Hex(bytes),
            detection_source: "bundle",
            status: "pending_split",
            attested_by: userId,
            attestation_statement: statement,
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
        await notifyAdminOfFormUpload({ origin, agentName, agentEmail, label: bundle.label });
        return json(
          {
            id: bundle.id,
            label: bundle.label,
            side: bundle.side,
            status: bundle.status,
            source_file_name: bundle.source_file_name,
            created_at: bundle.created_at.toISOString(),
            field_count: 0,
            needs_review_count: 0,
          },
          201
        );
      }

      // Recognition (known-forms) → exact AcroForm → guided vision. Shared with
      // the admin bundle-split via createUploadedForm so both paths place fields
      // identically.
      let result;
      try {
        result = await createUploadedForm({
          agentId: userId,
          s3Key: body.s3_key,
          bytes,
          label,
          side,
          formTypeId,
          market: agentMarket,
          fileName: body.file_name ?? "",
          mimeType: body.mime_type ?? "application/pdf",
        });
      } catch (err) {
        if (err instanceof FormTypeRequiredError) {
          await deleteObject(body.s3_key);
          return error(
            "pick the document type so we can detect this form's fields",
            422
          );
        }
        if (err instanceof FormDetectEnqueueError) {
          await deleteObject(body.s3_key);
          return error("couldn't start form detection — please try again", 503);
        }
        throw err;
      }

      await notifyAdminOfFormUpload({ origin, agentName, agentEmail, label: result.label });

      return json(
        {
          id: result.id,
          label: result.label,
          side: result.side,
          status: result.status,
          source_file_name: result.source_file_name,
          created_at: result.created_at.toISOString(),
          field_count: result.fieldCount,
          needs_review_count: result.needsReviewCount,
        },
        201
      );
    },
    { allowedRoles: ["agent", "admin"] }
  )) as Response;
}
