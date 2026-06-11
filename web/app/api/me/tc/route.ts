/**
 * /me/tc — the calling agent's own Transaction Coordinator (TC) contact.
 *
 * Mirrors GetMyTC / PutMyTC / DeleteMyTC in the legacy Go backend.
 *
 * The TC is stored two ways on the caller's own users row:
 *   - tc_contact  (Json?)   — the manual { name, email, phone } the agent typed.
 *   - tc_user_id  (uuid?)   — set only when a platform user with role='tc' and a
 *                             matching email exists, linking to that real account.
 *
 * GET    → ApiTCInfo { name, email, phone, user_id } from tc_contact (404 when
 *                      no TC is set — matches the Go "no tc assigned" 404; the
 *                      frontend useTC() treats a thrown 404 as null).
 * PUT    → ApiTCInfo. body { name, email, phone }. Trims name, lowercases email,
 *                      requires name+email. Looks up a role='tc' user by email to
 *                      populate tc_user_id, then writes tc_contact.
 * DELETE → 204. Clears tc_user_id AND tc_contact.
 */
import { error, json, withAuth } from "@/lib/http";
import { prisma } from "@/lib/db";
import { resolveUserId } from "@/lib/users";
import { Prisma } from "@/app/generated/prisma/client";

type ApiTCInfo = {
  name: string;
  email: string;
  phone: string;
  user_id: string | null;
};

export async function GET(req: Request): Promise<Response> {
  return (await withAuth(req, async (claims): Promise<Response> => {
    const userId = await resolveUserId(claims.sub);
    if (!userId) return error("user not found", 404);

    const row = await prisma.users.findUnique({
      where: { id: userId },
      select: { tc_user_id: true, tc_contact: true },
    });
    // No tc_contact = no TC assigned. Matches the Go handler's 404; useTC()'s
    // queryFn catches the thrown error and resolves to null.
    if (!row || row.tc_contact == null) {
      return error("no tc assigned", 404);
    }

    const contact = row.tc_contact as { name?: string; email?: string; phone?: string };
    const info: ApiTCInfo = {
      name: contact.name ?? "",
      email: contact.email ?? "",
      phone: contact.phone ?? "",
      user_id: row.tc_user_id ?? null,
    };
    return json(info);
  })) as Response;
}

type PutBody = { name?: string; email?: string; phone?: string };

export async function PUT(req: Request): Promise<Response> {
  return (await withAuth(req, async (claims): Promise<Response> => {
    const userId = await resolveUserId(claims.sub);
    if (!userId) return error("user not found", 404);

    let body: PutBody;
    try {
      body = (await req.json()) as PutBody;
    } catch {
      return error("invalid body", 400);
    }

    const name = (body.name ?? "").trim();
    const email = (body.email ?? "").trim().toLowerCase();
    const phone = body.phone ?? "";
    if (name === "" || email === "") {
      return error("name and email required", 400);
    }

    // Try to link a real platform TC by email (role='tc'). Optional — a TC the
    // agent typed manually need not have an account yet.
    const tcUser = await prisma.users.findFirst({
      where: { email, role: "tc" },
      select: { id: true },
    });
    const tcUserId = tcUser?.id ?? null;

    await prisma.users.update({
      where: { id: userId },
      data: {
        tc_user_id: tcUserId,
        tc_contact: { name, email, phone },
        updated_at: new Date(),
      },
    });

    const info: ApiTCInfo = { name, email, phone, user_id: tcUserId };
    return json(info);
  })) as Response;
}

export async function DELETE(req: Request): Promise<Response> {
  return (await withAuth(req, async (claims): Promise<Response> => {
    const userId = await resolveUserId(claims.sub);
    if (!userId) return error("user not found", 404);

    await prisma.users.update({
      where: { id: userId },
      data: { tc_user_id: null, tc_contact: Prisma.DbNull, updated_at: new Date() },
    });

    // 204 No Content — matches the Go DeleteMyTC. useTC().removeTC ignores the body.
    return new Response(null, { status: 204 });
  })) as Response;
}
