import { error, json, withAuth } from "@/lib/http";
import { prisma } from "@/lib/db";
import { resolveUserId } from "@/lib/users";
import { logAudit } from "@/lib/audit";

export async function GET(req: Request): Promise<Response> {
  return (await withAuth(
    req,
    async (): Promise<Response> => {
      const row = await prisma.system_config.findUnique({
        where: { id: 1 },
        select: { config: true, updated_at: true },
      });
      return json({
        config: row?.config ?? {},
        updated_at: (row?.updated_at ?? new Date()).toISOString(),
      });
    },
    { allowedRoles: ["admin"] }
  )) as Response;
}

type PutBody = { config?: unknown };

export async function PUT(req: Request): Promise<Response> {
  return (await withAuth(
    req,
    async (claims): Promise<Response> => {
      const userId = await resolveUserId(claims.sub);
      if (!userId) return error("user not found", 404);

      let body: PutBody;
      try {
        body = (await req.json()) as PutBody;
      } catch {
        return error("config is required", 400);
      }
      if (body.config === undefined) return error("config is required", 400);

      const row = await prisma.system_config.upsert({
        where: { id: 1 },
        create: {
          id: 1,
          config: body.config as never,
          updated_by: userId,
        },
        update: {
          config: body.config as never,
          updated_at: new Date(),
          updated_by: userId,
        },
      });
      logAudit({ actorId: userId, eventType: "config_update" });
      return json({
        config: row.config,
        updated_at: row.updated_at.toISOString(),
      });
    },
    { allowedRoles: ["admin"] }
  )) as Response;
}
