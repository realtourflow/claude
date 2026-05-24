import { json } from "@/lib/http";
import { prisma } from "@/lib/db";

// Semi-public — called by the Auth0 Post-Login Action to resolve a role
// for a given email. Returns "" if no role applies (which the Action then
// surfaces as a 403 the frontend can handle).
export async function GET(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const email = url.searchParams.get("email");
  if (!email) return json({ role: "" });

  const user = await prisma.users.findUnique({
    where: { email },
    select: { role: true },
  });
  if (user) return json({ role: user.role });

  const invite = await prisma.deal_invites.findFirst({
    where: { email, claimed_at: null, expires_at: { gt: new Date() } },
    orderBy: { created_at: "desc" },
    select: { role: true },
  });
  return json({ role: invite?.role ?? "" });
}
