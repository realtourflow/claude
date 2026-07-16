import { error, json, withAuth } from "@/lib/http";
import { prisma } from "@/lib/db";
import { hasRole } from "@/lib/roles";
import { enqueueFormDetectJob } from "@/lib/queue";
import { scheduleInlineFormDetect } from "@/lib/form-detect";

// Kicking a fresh detect runs the same INLINE vision attempt (via `after()`) the
// upload path does — minutes of model calls — so give it the full 300s budget.
export const maxDuration = 300;

type Ctx = { params: Promise<{ id: string }> };

// POST /api/admin/forms/:id/retry-detect — re-run guided-vision detection for a
// form stranded in 'detecting' (its detect job exhausted pg-boss's retries and
// parked in `failed`, leaving nothing to flip the row forward — #284). Mirrors
// the upload path: enqueue a durable backstop job, then attempt inline now.
// Valid ONLY while the form is still 'detecting'. Admin only.
export async function POST(req: Request, ctx: Ctx): Promise<Response> {
  const { id } = await ctx.params;
  return (await withAuth(req, async (claims): Promise<Response> => {
    if (!hasRole(claims.roles, ["admin"])) return error("forbidden", 403);

    const form = await prisma.uploaded_forms.findUnique({
      where: { id },
      select: { id: true, status: true },
    });
    if (!form) return error("form not found", 404);
    // Only a stuck-in-detection form can be retried; anything past detection
    // (pending_review / ready / rejected / split …) has already moved on.
    if (form.status !== "detecting") {
      return error("form is not detecting", 409);
    }

    // Enqueue the durable backstop first (the daily cron sweep), then attempt
    // inline immediately — same contract as the upload path (create-uploaded-form).
    let jobId: string | null;
    try {
      jobId = await enqueueFormDetectJob(id);
    } catch (err) {
      console.error(`retry-detect: could not enqueue detect job for ${id}`, err);
      return error("could not start field detection", 503);
    }
    scheduleInlineFormDetect(id, jobId);

    return json({ id, status: "detecting" });
  })) as Response;
}
