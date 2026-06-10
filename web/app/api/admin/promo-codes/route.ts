import { error, json, withAuth } from "@/lib/http";
import { prisma } from "@/lib/db";
import { resolveUserId } from "@/lib/users";
import { logAudit } from "@/lib/audit";

type PromoRow = {
  id: string;
  code: string;
  discount_type: string;
  discount_value: number | string;
  applies_to: string[];
  max_uses: number | null;
  uses_count: number;
  expires_at: Date | null;
  created_at: Date;
};

export async function GET(req: Request): Promise<Response> {
  return (await withAuth(
    req,
    async (): Promise<Response> => {
      const rows = await prisma.promo_codes.findMany({
        orderBy: { created_at: "desc" },
      });
      return json(
        rows.map((r) => ({
          ...r,
          discount_value:
            typeof r.discount_value === "object" && r.discount_value !== null
              ? (r.discount_value as { toNumber: () => number }).toNumber()
              : Number(r.discount_value),
          expires_at: r.expires_at?.toISOString() ?? null,
          created_at: r.created_at.toISOString(),
        }))
      );
    },
    { allowedRoles: ["admin"] }
  )) as Response;
}

type CreateBody = {
  code?: string;
  discount_type?: string;
  discount_value?: number;
  applies_to?: string[];
  max_uses?: number | null;
  expires_at?: string | null;
};

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
        return error("invalid body", 400);
      }
      const code = (body.code ?? "").trim().toUpperCase();
      if (
        !code ||
        (body.discount_type !== "pct" && body.discount_type !== "fixed")
      ) {
        return error("code and valid discount_type required", 400);
      }

      try {
        const row = (await prisma.promo_codes.create({
          data: {
            code,
            discount_type: body.discount_type,
            discount_value: body.discount_value ?? 0,
            applies_to: body.applies_to ?? [],
            max_uses: body.max_uses ?? null,
            expires_at: body.expires_at ? new Date(body.expires_at) : null,
            created_by: userId,
          },
        })) as unknown as PromoRow;
        await logAudit({
          actorId: userId,
          eventType: "promo_create",
          targetId: row.id,
          metadata: { code: row.code },
        });
        return json(
          {
            ...row,
            discount_value: Number(row.discount_value),
            expires_at: row.expires_at?.toISOString() ?? null,
            created_at: row.created_at.toISOString(),
          },
          201
        );
      } catch (err) {
        if (
          err &&
          typeof err === "object" &&
          "code" in err &&
          (err as { code: string }).code === "P2002"
        ) {
          return error("promo code already exists", 409);
        }
        throw err;
      }
    },
    { allowedRoles: ["admin"] }
  )) as Response;
}
