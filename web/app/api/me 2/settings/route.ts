import { error, json, withAuth } from "@/lib/http";
import { prisma } from "@/lib/db";
import { resolveUserId } from "@/lib/users";

export async function GET(req: Request): Promise<Response> {
  return (await withAuth(req, async (claims): Promise<Response> => {
    const userId = await resolveUserId(claims.sub);
    if (!userId) return error("user not found", 401);
    const row = await prisma.user_settings.findUnique({
      where: { user_id: userId },
      select: { settings: true },
    });
    return json(row?.settings ?? {});
  })) as Response;
}

export async function PUT(req: Request): Promise<Response> {
  return (await withAuth(req, async (claims): Promise<Response> => {
    const userId = await resolveUserId(claims.sub);
    if (!userId) return error("user not found", 401);

    let payload: unknown;
    try {
      payload = await req.json();
    } catch {
      return error("invalid JSON body", 400);
    }

    await prisma.user_settings.upsert({
      where: { user_id: userId },
      create: { user_id: userId, settings: payload as never },
      update: { settings: payload as never, updated_at: new Date() },
    });
    return json({ ok: true });
  })) as Response;
}
