/**
 * One-time backfill: add every existing waitlist signup to the Resend Audience.
 *
 * New signups sync automatically (web/app/api/waitlist/route.ts). This catches
 * the people who signed up before the audience sync existed. Idempotent-ish:
 * Resend rejects duplicates, which are logged and skipped.
 *
 * Run with prod env vars (DATABASE_URL, RESEND_API_KEY, RESEND_AUDIENCE_ID):
 *   npx tsx --env-file=<prod-env-file> scripts/backfill-waitlist-audience.ts
 */
import { prisma } from "@/lib/db";
import { addToWaitlistAudience } from "@/lib/email";

async function main(): Promise<void> {
  if (!process.env.RESEND_AUDIENCE_ID) {
    console.error("RESEND_AUDIENCE_ID is not set — set it (and RESEND_API_KEY) before backfilling.");
    process.exit(1);
  }

  const rows = await prisma.$queryRaw<
    { first_name: string; last_name: string; email: string }[]
  >`SELECT first_name, last_name, email FROM waitlist ORDER BY created_at ASC`;

  console.log(`Backfilling ${rows.length} waitlist signup(s) into the Resend Audience…`);
  let ok = 0;
  let fail = 0;
  for (const r of rows) {
    try {
      await addToWaitlistAudience({ email: r.email, firstName: r.first_name, lastName: r.last_name });
      ok++;
      console.log(`  ✓ ${r.email}`);
    } catch (e) {
      fail++;
      console.error(`  ✗ ${r.email}:`, e instanceof Error ? e.message : e);
    }
  }
  console.log(`Done. ${ok} added, ${fail} failed/skipped.`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
