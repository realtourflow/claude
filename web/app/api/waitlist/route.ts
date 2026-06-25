import { z } from "zod";
import { json, error } from "@/lib/http";
import { prisma } from "@/lib/db";
import { sendNotificationEmail } from "@/lib/email";

const schema = z.object({
  firstName: z.string().min(1).max(100).trim(),
  lastName: z.string().min(1).max(100).trim(),
  email: z.string().email().max(255).trim().toLowerCase(),
  brokerage: z.string().max(200).trim().optional(),
});

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return error("Invalid JSON", 400);
  }

  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return error(parsed.error.issues[0].message, 400);
  }

  const { firstName, lastName, email, brokerage } = parsed.data;

  try {
    await prisma.$executeRaw`
      INSERT INTO waitlist (first_name, last_name, email, brokerage)
      VALUES (${firstName}, ${lastName}, ${email}, ${brokerage ?? null})
      ON CONFLICT (email) DO NOTHING
    `;
  } catch (e) {
    console.error("[waitlist] insert error:", e);
    return error("Something went wrong. Please try again.", 500);
  }

  try {
    await sendNotificationEmail({
      to: "paul@mountain.mortgage",
      subject: `New waitlist signup: ${firstName} ${lastName}`,
      heading: "New RealTourFlow waitlist signup",
      body: `${firstName} ${lastName} (${email})${brokerage ? ` — ${brokerage}` : ""} just signed up for early access.`,
      dealUrl: "https://realtourflow.com",
    });
  } catch {
    // best-effort — don't fail the response if email fails
  }

  return json({ ok: true });
}
