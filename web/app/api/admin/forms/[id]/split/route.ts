import { error, json, withAuth } from "@/lib/http";
import { prisma } from "@/lib/db";
import { hasRole } from "@/lib/roles";
import { resolveUserId } from "@/lib/users";
import {
  getObjectBytes,
  putObjectBytes,
  makeAgentFormS3Key,
  deleteObject,
} from "@/lib/s3";
import { PDFDocument } from "pdf-lib";
import { FORM_SIDES, type FormSide } from "@/lib/uploaded-forms";
import { createUploadedForm, FormTypeRequiredError } from "@/lib/create-uploaded-form";
import { sha256Hex } from "@/lib/uploaded-forms";

// Loading + slicing a multi-form bundle PDF is heavier than a JSON call — and
// each flat child kicks off an INLINE vision detect (#193) that runs via
// `after()` inside this same invocation, so give it the full 300s (matching
// /api/jobs/process). The response itself still returns as soon as the carve
// finishes; any child whose detect outlives the budget falls back to the sweep.
export const maxDuration = 300;

type Ctx = { params: Promise<{ id: string }> };

type Part = {
  start_page?: number;
  end_page?: number;
  form_type?: string;
  label?: string;
  side?: string;
};
type SplitBody = { parts?: Part[] };

// POST /api/admin/forms/[id]/split — carve a `pending_split` BUNDLE PDF into
// separate forms by page range. Each part becomes its own PDF + uploaded_forms
// row that runs the normal recognition→AcroForm/vision pipeline. Because each
// child is its own PDF, its field positions are correct with NO coordinate
// re-basing — the split's whole safety argument.
export async function POST(req: Request, ctx: Ctx): Promise<Response> {
  const { id } = await ctx.params;
  return (await withAuth(req, async (claims): Promise<Response> => {
    if (!hasRole(claims.roles, ["admin"])) return error("forbidden", 403);
    const adminId = await resolveUserId(claims.sub);
    if (!adminId) return error("user not found", 401);

    let body: SplitBody;
    try {
      body = (await req.json()) as SplitBody;
    } catch {
      return error("invalid request body", 400);
    }
    const parts = body.parts ?? [];
    if (parts.length === 0) return error("at least one part is required", 400);

    const bundle = await prisma.uploaded_forms.findUnique({
      where: { id },
      select: {
        id: true,
        agent_id: true,
        status: true,
        source_s3_key: true,
        board: true,
        attestation_statement: true,
      },
    });
    if (!bundle) return error("form not found", 404);
    if (bundle.status !== "pending_split") {
      return error("this form is not a bundle awaiting split", 409);
    }

    // Load the source PDF + its page count.
    let srcDoc: PDFDocument;
    try {
      const srcBytes = await getObjectBytes(bundle.source_s3_key);
      srcDoc = await PDFDocument.load(srcBytes, { ignoreEncryption: true });
    } catch {
      return error("could not read the bundle PDF", 400);
    }
    const pageCount = srcDoc.getPageCount();

    // Validate + resolve EVERY part before creating anything.
    type Resolved = {
      start: number;
      end: number;
      formTypeId: string;
      label: string;
      side: FormSide;
    };
    const resolved: Resolved[] = [];
    for (const [i, p] of parts.entries()) {
      const start = Number(p.start_page);
      const end = Number(p.end_page);
      const label = (p.label ?? "").trim();
      const side = p.side as FormSide;
      if (
        !Number.isInteger(start) ||
        !Number.isInteger(end) ||
        start < 1 ||
        end < start ||
        end > pageCount
      ) {
        return error(`part ${i + 1}: page range must be within 1–${pageCount}`, 400);
      }
      if (!label) return error(`part ${i + 1}: a name is required`, 400);
      if (!FORM_SIDES.includes(side)) {
        return error(`part ${i + 1}: side must be buy, sell, or both`, 400);
      }
      if (!p.form_type) return error(`part ${i + 1}: pick a document type`, 400);
      const t = await prisma.form_types.findUnique({
        where: { key: p.form_type },
        select: { id: true, active: true },
      });
      if (!t || !t.active) return error(`part ${i + 1}: unknown document type`, 400);
      resolved.push({ start, end, formTypeId: t.id, label, side });
    }

    // Carve each part into its own PDF, store it, and process it like a fresh
    // upload. Best-effort per child so one bad part doesn't sink the whole split.
    // `already_existed` children were skipped by the re-split duplicate guard —
    // they count as succeeded (no failure) so a full re-submit still archives.
    const created: { id: string; label: string; already_existed?: boolean }[] = [];
    const failed: { label: string; error: string }[] = [];
    for (const r of resolved) {
      let childBytes: Uint8Array;
      try {
        // `updateMetadata: false` keeps the carve deterministic (pdf-lib otherwise
        // stamps CreationDate/ModDate into each save) — a re-carve of the same
        // pages yields byte-identical output, which is what makes the file_sha256
        // duplicate guard below reliable on re-split.
        const childDoc = await PDFDocument.create({ updateMetadata: false });
        const indices: number[] = [];
        for (let pg = r.start - 1; pg <= r.end - 1; pg++) indices.push(pg);
        const copied = await childDoc.copyPages(srcDoc, indices);
        copied.forEach((pg) => childDoc.addPage(pg));
        childBytes = await childDoc.save();
      } catch {
        failed.push({ label: r.label, error: "could not extract those pages" });
        continue;
      }

      // Re-split guard: if this exact carve already produced a child for this
      // agent (byte-identical → same hash), skip it instead of duplicating. Lets
      // an admin re-submit ALL ranges to retry the failed parts without cloning
      // the children that already succeeded. (`uploaded_forms` has no bundle-link
      // column, so file_sha256 is the join key — see #285.)
      const childSha = sha256Hex(childBytes);
      const dupe = await prisma.uploaded_forms.findFirst({
        where: { agent_id: bundle.agent_id, file_sha256: childSha },
        select: { id: true, label: true },
      });
      if (dupe) {
        created.push({ id: dupe.id, label: dupe.label, already_existed: true });
        continue;
      }

      const fileName = `${r.label.replace(/[^\w.-]+/g, "-") || "form"}.pdf`;
      const s3Key = makeAgentFormS3Key(bundle.agent_id, fileName);
      try {
        await putObjectBytes(s3Key, childBytes, "application/pdf");
      } catch {
        failed.push({ label: r.label, error: "could not store the split PDF" });
        continue;
      }

      try {
        const child = await createUploadedForm({
          agentId: bundle.agent_id,
          s3Key,
          bytes: childBytes,
          label: r.label,
          side: r.side,
          formTypeId: r.formTypeId,
          market: bundle.board,
          fileName,
          mimeType: "application/pdf",
          attestationStatement: bundle.attestation_statement,
        });
        created.push({ id: child.id, label: child.label });
      } catch (e) {
        await deleteObject(s3Key).catch(() => {});
        if (e instanceof FormTypeRequiredError) {
          failed.push({ label: r.label, error: "needs a document type" });
        } else {
          failed.push({ label: r.label, error: "processing failed" });
        }
      }
    }

    // Archive the bundle ONLY when every part landed (#285). On partial failure it
    // stays `pending_split` and visible in the admin Pending queue, so the failed
    // ranges can be re-split — the sha256 guard above keeps that re-split from
    // duplicating the children that already succeeded.
    if (failed.length === 0) {
      await prisma.uploaded_forms.update({
        where: { id },
        data: { status: "split", reviewed_by: adminId, reviewed_at: new Date() },
      });
    }

    return json({ created, failed, page_count: pageCount });
  })) as Response;
}
