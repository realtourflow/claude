import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import {
  GET as getConfigRoute,
  PUT as putConfigRoute,
} from "@/app/api/admin/config/route";
import {
  GET as listPromosRoute,
  POST as createPromoRoute,
} from "@/app/api/admin/promo-codes/route";
import { DELETE as deletePromoRoute } from "@/app/api/admin/promo-codes/[id]/route";
import { POST as reviewBrokerageRoute } from "@/app/api/admin/brokerages/[id]/route";
import { GET as auditLogRoute } from "@/app/api/admin/audit-log/route";
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

describe("Admin role gate", () => {
  it("403 for non-admin on every admin endpoint", async () => {
    await createUser({ role: "agent", auth0_id: "auth0|a" });
    const headers = { authorization: await authHeader("auth0|a", ["agent"]) };
    const r1 = await getConfigRoute(
      new Request("http://localhost/api/admin/config", { headers })
    );
    expect(r1.status).toBe(403);
    const r2 = await listPromosRoute(
      new Request("http://localhost/api/admin/promo-codes", { headers })
    );
    expect(r2.status).toBe(403);
    const r3 = await auditLogRoute(
      new Request("http://localhost/api/admin/audit-log", { headers })
    );
    expect(r3.status).toBe(403);
  });
});

describe("System config", () => {
  it("returns empty config when no row exists; PUT upserts", async () => {
    await createUser({ role: "admin", auth0_id: "auth0|admin" });
    const headers = { authorization: await authHeader("auth0|admin", ["admin"]) };

    const getRes = await getConfigRoute(
      new Request("http://localhost/api/admin/config", { headers })
    );
    expect(getRes.status).toBe(200);
    expect(((await getRes.json()) as { config: unknown }).config).toEqual({});

    const putRes = await putConfigRoute(
      new Request("http://localhost/api/admin/config", {
        method: "PUT",
        headers: { ...headers, "content-type": "application/json" },
        body: JSON.stringify({ config: { feature_x: true } }),
      })
    );
    expect(putRes.status).toBe(200);
    const after = (await putRes.json()) as { config: { feature_x: boolean } };
    expect(after.config.feature_x).toBe(true);
  });

  it("400 when PUT body is missing config field", async () => {
    await createUser({ role: "admin", auth0_id: "auth0|admin" });
    const res = await putConfigRoute(
      new Request("http://localhost/api/admin/config", {
        method: "PUT",
        headers: {
          authorization: await authHeader("auth0|admin", ["admin"]),
          "content-type": "application/json",
        },
        body: JSON.stringify({}),
      })
    );
    expect(res.status).toBe(400);
  });
});

describe("Promo codes", () => {
  it("create + list + delete", async () => {
    await createUser({ role: "admin", auth0_id: "auth0|admin" });
    const headers = { authorization: await authHeader("auth0|admin", ["admin"]) };

    const createRes = await createPromoRoute(
      new Request("http://localhost/api/admin/promo-codes", {
        method: "POST",
        headers: { ...headers, "content-type": "application/json" },
        body: JSON.stringify({
          code: "summer25",
          discount_type: "pct",
          discount_value: 25,
        }),
      })
    );
    expect(createRes.status).toBe(201);
    const p = (await createRes.json()) as { id: string; code: string };
    expect(p.code).toBe("SUMMER25"); // upper-cased

    const listRes = await listPromosRoute(
      new Request("http://localhost/api/admin/promo-codes", { headers })
    );
    expect(((await listRes.json()) as unknown[]).length).toBe(1);

    const delRes = await deletePromoRoute(
      new Request(`http://localhost/api/admin/promo-codes/${p.id}`, {
        method: "DELETE",
        headers,
      }),
      { params: Promise.resolve({ id: p.id }) }
    );
    expect(delRes.status).toBe(204);
  });

  it("409 on duplicate code", async () => {
    await createUser({ role: "admin", auth0_id: "auth0|admin" });
    const headers = {
      authorization: await authHeader("auth0|admin", ["admin"]),
      "content-type": "application/json",
    };
    const body = JSON.stringify({
      code: "DUPE",
      discount_type: "fixed",
      discount_value: 10,
    });
    await createPromoRoute(
      new Request("http://localhost/api/admin/promo-codes", {
        method: "POST",
        headers,
        body,
      })
    );
    const res2 = await createPromoRoute(
      new Request("http://localhost/api/admin/promo-codes", {
        method: "POST",
        headers,
        body,
      })
    );
    expect(res2.status).toBe(409);
  });

  it("400 on invalid discount_type", async () => {
    await createUser({ role: "admin", auth0_id: "auth0|admin" });
    const res = await createPromoRoute(
      new Request("http://localhost/api/admin/promo-codes", {
        method: "POST",
        headers: {
          authorization: await authHeader("auth0|admin", ["admin"]),
          "content-type": "application/json",
        },
        body: JSON.stringify({ code: "X", discount_type: "weird" }),
      })
    );
    expect(res.status).toBe(400);
  });
});

describe("Audit log", () => {
  type AuditEntry = {
    id: string;
    actor_id: string | null;
    actor_name: string | null;
    actor_email: string | null;
    event_type: string;
    deal_id: string | null;
    deal_title: string | null;
    target_id: string | null;
    metadata: unknown;
    created_at: string;
  };
  type AuditBody = { entries: AuditEntry[]; total: number };

  it("returns an {entries, total} object, not a bare array", async () => {
    const admin = await createUser({
      role: "admin",
      auth0_id: "auth0|admin",
      name: "Admin Z",
    });
    await prisma.audit_log.createMany({
      data: [
        { actor_id: admin.id, event_type: "test_1" },
        { actor_id: admin.id, event_type: "test_2" },
      ],
    });
    const res = await auditLogRoute(
      new Request("http://localhost/api/admin/audit-log?limit=10", {
        headers: { authorization: await authHeader("auth0|admin", ["admin"]) },
      })
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as AuditBody;
    // The bug: route used to return a bare array, so entries/total were undefined.
    expect(Array.isArray(body)).toBe(false);
    expect(Array.isArray(body.entries)).toBe(true);
    expect(body.entries.length).toBe(2);
    expect(body.total).toBe(2);
    expect(body.entries[0].actor_name).toBe("Admin Z");
  });

  it("honors the event_type query param in the WHERE clause", async () => {
    const admin = await createUser({ role: "admin", auth0_id: "auth0|admin" });
    await prisma.audit_log.createMany({
      data: [
        { actor_id: admin.id, event_type: "user_deactivated" },
        { actor_id: admin.id, event_type: "invite_created" },
        { actor_id: admin.id, event_type: "user_deactivated" },
      ],
    });
    const res = await auditLogRoute(
      new Request(
        "http://localhost/api/admin/audit-log?event_type=user_deactivated",
        { headers: { authorization: await authHeader("auth0|admin", ["admin"]) } }
      )
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as AuditBody;
    expect(body.total).toBe(2);
    expect(body.entries.length).toBe(2);
    expect(body.entries.every((e) => e.event_type === "user_deactivated")).toBe(
      true
    );
  });

  it("enriches entries with actor_email and deal_title via LEFT JOINs", async () => {
    const admin = await createUser({
      role: "admin",
      auth0_id: "auth0|admin",
      name: "Admin Z",
      email: "adminz@example.com",
    });
    const deal = await createDeal({ agent_id: admin.id, title: "123 Main St" });
    await prisma.audit_log.createMany({
      data: [
        { actor_id: admin.id, event_type: "with_deal", deal_id: deal.id },
        { actor_id: admin.id, event_type: "no_deal" },
      ],
    });
    const res = await auditLogRoute(
      new Request("http://localhost/api/admin/audit-log", {
        headers: { authorization: await authHeader("auth0|admin", ["admin"]) },
      })
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as AuditBody;
    const byType = Object.fromEntries(body.entries.map((e) => [e.event_type, e]));
    expect(byType["with_deal"].actor_email).toBe("adminz@example.com");
    expect(byType["with_deal"].deal_title).toBe("123 Main St");
    // A row with no deal LEFT JOINs to a null title (not an error).
    expect(byType["no_deal"].deal_title).toBeNull();
    expect(byType["no_deal"].actor_email).toBe("adminz@example.com");
  });
});

describe("Brokerage review audit", () => {
  async function pendingBrokerage(name: string, suggestedBy?: string) {
    return prisma.brokerages.create({
      data: { name, status: "pending", suggested_by: suggestedBy ?? null },
      select: { id: true, name: true },
    });
  }

  it("approve writes a brokerage_approve audit row with actor + target", async () => {
    const admin = await createUser({ role: "admin", auth0_id: "auth0|admin" });
    const agent = await createUser({ role: "agent", auth0_id: "auth0|agent" });
    const b = await pendingBrokerage("Keller Williams Summit", agent.id);

    const res = await reviewBrokerageRoute(
      new Request(`http://localhost/api/admin/brokerages/${b.id}`, {
        method: "POST",
        headers: {
          authorization: await authHeader("auth0|admin", ["admin"]),
          "content-type": "application/json",
        },
        body: JSON.stringify({ action: "approve" }),
      }),
      { params: Promise.resolve({ id: b.id }) }
    );
    expect(res.status).toBe(200);
    expect(((await res.json()) as { status: string }).status).toBe("active");

    const rows = await prisma.audit_log.findMany({
      where: { event_type: "brokerage_approve" },
    });
    expect(rows.length).toBe(1);
    expect(rows[0].target_id).toBe(b.id);
    expect(rows[0].actor_id).toBe(admin.id);
  });

  it("reject writes a brokerage_reject audit row with actor + target", async () => {
    const admin = await createUser({ role: "admin", auth0_id: "auth0|admin" });
    const b = await pendingBrokerage("Bogus Brokerage LLC");

    const res = await reviewBrokerageRoute(
      new Request(`http://localhost/api/admin/brokerages/${b.id}`, {
        method: "POST",
        headers: {
          authorization: await authHeader("auth0|admin", ["admin"]),
          "content-type": "application/json",
        },
        body: JSON.stringify({ action: "reject" }),
      }),
      { params: Promise.resolve({ id: b.id }) }
    );
    expect(res.status).toBe(200);
    expect(((await res.json()) as { status: string }).status).toBe("rejected");

    const rows = await prisma.audit_log.findMany({
      where: { event_type: "brokerage_reject" },
    });
    expect(rows.length).toBe(1);
    expect(rows[0].target_id).toBe(b.id);
    expect(rows[0].actor_id).toBe(admin.id);
  });

  it("audit-log endpoint filters on the two new brokerage event types", async () => {
    await createUser({ role: "admin", auth0_id: "auth0|admin" });
    const headers = {
      authorization: await authHeader("auth0|admin", ["admin"]),
      "content-type": "application/json",
    };
    const approved = await pendingBrokerage("Approve Co");
    const rejected = await pendingBrokerage("Reject Co");

    await reviewBrokerageRoute(
      new Request(`http://localhost/api/admin/brokerages/${approved.id}`, {
        method: "POST",
        headers,
        body: JSON.stringify({ action: "approve" }),
      }),
      { params: Promise.resolve({ id: approved.id }) }
    );
    await reviewBrokerageRoute(
      new Request(`http://localhost/api/admin/brokerages/${rejected.id}`, {
        method: "POST",
        headers,
        body: JSON.stringify({ action: "reject" }),
      }),
      { params: Promise.resolve({ id: rejected.id }) }
    );

    type AuditBody = {
      entries: { event_type: string; target_id: string | null }[];
      total: number;
    };

    const approveRes = await auditLogRoute(
      new Request(
        "http://localhost/api/admin/audit-log?event_type=brokerage_approve",
        { headers: { authorization: await authHeader("auth0|admin", ["admin"]) } }
      )
    );
    expect(approveRes.status).toBe(200);
    const approveBody = (await approveRes.json()) as AuditBody;
    expect(approveBody.total).toBe(1);
    expect(approveBody.entries.length).toBe(1);
    expect(approveBody.entries[0].event_type).toBe("brokerage_approve");
    expect(approveBody.entries[0].target_id).toBe(approved.id);

    const rejectRes = await auditLogRoute(
      new Request(
        "http://localhost/api/admin/audit-log?event_type=brokerage_reject",
        { headers: { authorization: await authHeader("auth0|admin", ["admin"]) } }
      )
    );
    expect(rejectRes.status).toBe(200);
    const rejectBody = (await rejectRes.json()) as AuditBody;
    expect(rejectBody.total).toBe(1);
    expect(rejectBody.entries.length).toBe(1);
    expect(rejectBody.entries[0].event_type).toBe("brokerage_reject");
    expect(rejectBody.entries[0].target_id).toBe(rejected.id);
  });
});
