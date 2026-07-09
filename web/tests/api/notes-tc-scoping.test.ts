/**
 * PATCH /api/deals/[id]/notes — TC tenant scoping (#172 write surfaces).
 *
 * Internal notes are agent-private deal data. Only the owning agent, the
 * agent's linked TC (users.tc_user_id = caller), or an admin may write
 * them. An unlinked TC must never be able to overwrite a foreign deal's
 * notes. Lives in its own file (not deals.test.ts) to stay clear of the
 * open PR #221 diff.
 */
import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { PATCH as notesRoute } from "@/app/api/deals/[id]/notes/route";
import { setVerifyOptionsForTesting } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { authHeader, getTestSigner } from "../helpers/jwt";
import { truncateAll } from "../helpers/db";
import { createUser, createDeal } from "../helpers/factories";

beforeAll(async () => {
  const { verifyOpts } = await getTestSigner();
  setVerifyOptionsForTesting(verifyOpts);
});

beforeEach(async () => {
  await truncateAll();
});

function ctx(id: string) {
  return { params: Promise.resolve({ id }) };
}

async function patchNotes(dealId: string, notes: string, sub: string, roles: string[]) {
  return notesRoute(
    new Request(`http://localhost/api/deals/${dealId}/notes`, {
      method: "PATCH",
      headers: {
        "content-type": "application/json",
        authorization: await authHeader(sub, roles),
      },
      body: JSON.stringify({ notes }),
    }),
    ctx(dealId)
  );
}

async function notesOf(dealId: string): Promise<string | null | undefined> {
  const row = await prisma.deals.findUnique({
    where: { id: dealId },
    select: { notes: true },
  });
  return row?.notes;
}

describe("PATCH /api/deals/[id]/notes — TC tenant scoping", () => {
  it("a linked TC (agent.tc_user_id = caller) can update the deal's notes", async () => {
    const tc = await createUser({ role: "tc", auth0_id: "auth0|tc-linked" });
    const agent = await createUser({ role: "agent" });
    await prisma.users.update({
      where: { id: agent.id },
      data: { tc_user_id: tc.id },
    });
    const deal = await createDeal({ agent_id: agent.id });

    const res = await patchNotes(deal.id, "tc note", "auth0|tc-linked", ["tc"]);
    expect(res.status).toBe(200);
    await expect(notesOf(deal.id)).resolves.toBe("tc note");
  });

  it("an UNLINKED TC gets 403 and the notes are unchanged", async () => {
    await createUser({ role: "tc", auth0_id: "auth0|tc-outsider" });
    const agent = await createUser({ role: "agent" }); // no tc_user_id link
    const deal = await createDeal({ agent_id: agent.id });
    await prisma.deals.update({
      where: { id: deal.id },
      data: { notes: "original" },
    });

    const res = await patchNotes(deal.id, "overwritten", "auth0|tc-outsider", ["tc"]);
    expect(res.status).toBe(403);
    await expect(notesOf(deal.id)).resolves.toBe("original");
  });

  it("a TC linked to a DIFFERENT agent gets 403 on a foreign deal", async () => {
    const tc = await createUser({ role: "tc", auth0_id: "auth0|tc-other" });
    const ownAgent = await createUser({ role: "agent" });
    await prisma.users.update({
      where: { id: ownAgent.id },
      data: { tc_user_id: tc.id },
    });
    const foreignAgent = await createUser({ role: "agent" });
    const foreignDeal = await createDeal({ agent_id: foreignAgent.id });
    await prisma.deals.update({
      where: { id: foreignDeal.id },
      data: { notes: "original" },
    });

    const res = await patchNotes(foreignDeal.id, "overwritten", "auth0|tc-other", ["tc"]);
    expect(res.status).toBe(403);
    await expect(notesOf(foreignDeal.id)).resolves.toBe("original");
  });

  it("an admin stays global — can update any deal's notes without a link", async () => {
    await createUser({ role: "admin", auth0_id: "auth0|admin" });
    const agent = await createUser({ role: "agent" });
    const deal = await createDeal({ agent_id: agent.id });

    const res = await patchNotes(deal.id, "admin note", "auth0|admin", ["admin"]);
    expect(res.status).toBe(200);
    await expect(notesOf(deal.id)).resolves.toBe("admin note");
  });

  it("the owning agent still works (regression guard)", async () => {
    const agent = await createUser({ role: "agent", auth0_id: "auth0|owner" });
    const deal = await createDeal({ agent_id: agent.id });

    const res = await patchNotes(deal.id, "my note", "auth0|owner", ["agent"]);
    expect(res.status).toBe(200);
    await expect(notesOf(deal.id)).resolves.toBe("my note");
  });
});
