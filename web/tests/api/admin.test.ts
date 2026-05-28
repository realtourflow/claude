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
import { GET as auditLogRoute } from "@/app/api/admin/audit-log/route";
import { setVerifyOptionsForTesting } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { authHeader, getTestSigner } from "../helpers/jwt";
import { truncateAll } from "../helpers/db";
import { createUser } from "../helpers/factories";

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
  it("returns recent entries with actor name (limit + offset)", async () => {
    const admin = await createUser({ role: "admin", auth0_id: "auth0|admin", name: "Admin Z" });
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
    const body = (await res.json()) as {
      event_type: string;
      actor_name: string | null;
    }[];
    expect(body.length).toBe(2);
    expect(body[0].actor_name).toBe("Admin Z");
  });
});
