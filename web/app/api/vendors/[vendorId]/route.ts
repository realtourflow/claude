import { error, json, withAuth } from "@/lib/http";
import { prisma } from "@/lib/db";
import { resolveUserId } from "@/lib/users";
import { serializeVendor } from "@/lib/vendors";

type Ctx = { params: Promise<{ vendorId: string }> };

type PatchBody = {
  company?: string;
  contact_name?: string;
  phone?: string;
  email?: string;
  website?: string;
  notes?: string;
  is_featured?: boolean;
  sort_order?: number;
};

export async function PATCH(req: Request, ctx: Ctx): Promise<Response> {
  const { vendorId } = await ctx.params;
  return (await withAuth(req, async (claims): Promise<Response> => {
    const userId = await resolveUserId(claims.sub);
    if (!userId) return error("user not found", 401);

    let body: PatchBody;
    try {
      body = (await req.json()) as PatchBody;
    } catch {
      return error("invalid body", 400);
    }

    // Only the fields present in the body are updated (mirrors the Go handler's
    // COALESCE($x, col): a missing field is left untouched, "" is written).
    const data: Record<string, unknown> = {};
    if (typeof body.company === "string") data.company = body.company;
    if (typeof body.contact_name === "string") data.contact_name = body.contact_name;
    if (typeof body.phone === "string") data.phone = body.phone;
    if (typeof body.email === "string") data.email = body.email;
    if (typeof body.website === "string") data.website = body.website;
    if (typeof body.notes === "string") data.notes = body.notes;
    if (typeof body.is_featured === "boolean") data.is_featured = body.is_featured;
    if (typeof body.sort_order === "number") data.sort_order = body.sort_order;

    // Ownership-scoped update: only rows where agent_id == caller are touched.
    const result = await prisma.preferred_vendors.updateMany({
      where: { id: vendorId, agent_id: userId },
      data,
    });
    if (result.count === 0) return error("not found or forbidden", 404);

    const row = await prisma.preferred_vendors.findUnique({ where: { id: vendorId } });
    if (!row) return error("not found or forbidden", 404);
    return json(serializeVendor(row));
  })) as Response;
}

export async function DELETE(req: Request, ctx: Ctx): Promise<Response> {
  const { vendorId } = await ctx.params;
  return (await withAuth(req, async (claims): Promise<Response> => {
    const userId = await resolveUserId(claims.sub);
    if (!userId) return error("user not found", 401);

    // Ownership-scoped delete: returns 404 if it doesn't belong to the caller.
    const result = await prisma.preferred_vendors.deleteMany({
      where: { id: vendorId, agent_id: userId },
    });
    if (result.count === 0) return error("not found or forbidden", 404);
    return new Response(null, { status: 204 });
  })) as Response;
}
