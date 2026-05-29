import { error, json, withAuth } from "@/lib/http";
import { prisma } from "@/lib/db";
import { resolveUserId } from "@/lib/users";

type PatchBody = {
  name?: string;
  phone?: string | null;
};

export async function PATCH(req: Request): Promise<Response> {
  return (await withAuth(req, async (claims): Promise<Response> => {
    const userId = await resolveUserId(claims.sub);
    if (!userId) return error("user not found", 401);

    let body: PatchBody;
    try {
      body = (await req.json()) as PatchBody;
    } catch {
      return error("invalid request body", 400);
    }

    const data: { name?: string; phone?: string | null; onboarding_complete: boolean; updated_at: Date } = {
      onboarding_complete: true,
      updated_at: new Date(),
    };
    if (typeof body.name === "string") data.name = body.name;
    if (body.phone !== undefined) data.phone = body.phone;

    await prisma.users.update({
      where: { id: userId },
      data,
    });
    return json({ ok: true });
  })) as Response;
}
