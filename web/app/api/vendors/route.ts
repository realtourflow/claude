import { error, json, withAuth } from "@/lib/http";
import { prisma } from "@/lib/db";
import { resolveUserId } from "@/lib/users";
import { serializeVendor, type VendorRow } from "@/lib/vendors";

export async function GET(req: Request): Promise<Response> {
  return (await withAuth(req, async (claims): Promise<Response> => {
    const userId = await resolveUserId(claims.sub);
    if (!userId) return error("user not found", 401);

    const rows = await prisma.preferred_vendors.findMany({
      where: { agent_id: userId },
      orderBy: [{ category: "asc" }, { sort_order: "asc" }, { created_at: "asc" }],
    });
    return json(rows.map(serializeVendor));
  })) as Response;
}

type CreateBody = {
  category?: string;
  company?: string;
  contact_name?: string;
  phone?: string;
  email?: string;
  website?: string;
  notes?: string;
  is_featured?: boolean;
};

// Empty strings are stored as NULL (mirrors the Go handler's NULLIF($x,'')).
function nullIfEmpty(s: string | undefined): string | null {
  return s ? s : null;
}

export async function POST(req: Request): Promise<Response> {
  return (await withAuth(req, async (claims): Promise<Response> => {
    const userId = await resolveUserId(claims.sub);
    if (!userId) return error("user not found", 401);

    let body: CreateBody;
    try {
      body = (await req.json()) as CreateBody;
    } catch {
      return error("invalid body", 400);
    }
    if (!body.category || !body.company) {
      return error("category and company required", 400);
    }

    // Auto-set sort_order = max in this agent's category + 1 (matches Go handler).
    const agg = await prisma.preferred_vendors.aggregate({
      where: { agent_id: userId, category: body.category },
      _max: { sort_order: true },
    });
    const nextSortOrder = (agg._max.sort_order ?? -1) + 1;

    const row: VendorRow = await prisma.preferred_vendors.create({
      data: {
        agent_id: userId,
        category: body.category,
        company: body.company,
        contact_name: nullIfEmpty(body.contact_name),
        phone: nullIfEmpty(body.phone),
        email: nullIfEmpty(body.email),
        website: nullIfEmpty(body.website),
        notes: nullIfEmpty(body.notes),
        is_featured: body.is_featured ?? false,
        sort_order: nextSortOrder,
      },
    });
    return json(serializeVendor(row), 201);
  })) as Response;
}
