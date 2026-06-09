import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import {
  GET as listVendorsRoute,
  POST as createVendorRoute,
} from "@/app/api/vendors/route";
import {
  PATCH as patchVendorRoute,
  DELETE as deleteVendorRoute,
} from "@/app/api/vendors/[vendorId]/route";
import { setVerifyOptionsForTesting } from "@/lib/auth";
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

function ctx<T extends Record<string, string>>(p: T) {
  return { params: Promise.resolve(p) };
}

type ApiVendor = {
  id: string;
  agent_id: string;
  category: string;
  company: string;
  contact_name: string;
  phone: string;
  email: string;
  website: string;
  notes: string;
  is_featured: boolean;
  sort_order: number;
  created_at: string;
};

async function create(
  auth0: string,
  body: Record<string, unknown>
): Promise<Response> {
  return createVendorRoute(
    new Request("http://localhost/api/vendors", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: await authHeader(auth0, ["agent"]),
      },
      body: JSON.stringify(body),
    })
  );
}

describe("POST /vendors", () => {
  it("creates a vendor and returns the full ApiVendor shape", async () => {
    await createUser({ role: "agent", auth0_id: "auth0|a" });

    const res = await create("auth0|a", {
      category: "lender",
      company: "Mountain Mortgage",
      contact_name: "Paul Leara",
      phone: "205-401-9076",
      email: "paul@mountain.mortgage",
      website: "https://mountain.mortgage",
      notes: "Fast Pass partner",
      is_featured: true,
    });
    expect(res.status).toBe(201);

    const v = (await res.json()) as ApiVendor;
    expect(v.id).toBeTruthy();
    expect(v.agent_id).toBeTruthy();
    expect(v.category).toBe("lender");
    expect(v.company).toBe("Mountain Mortgage");
    expect(v.contact_name).toBe("Paul Leara");
    expect(v.phone).toBe("205-401-9076");
    expect(v.email).toBe("paul@mountain.mortgage");
    expect(v.website).toBe("https://mountain.mortgage");
    expect(v.notes).toBe("Fast Pass partner");
    expect(v.is_featured).toBe(true);
    expect(v.sort_order).toBe(0);
    expect(typeof v.created_at).toBe("string");
  });

  it("returns empty strings (not null) for omitted optional fields", async () => {
    await createUser({ role: "agent", auth0_id: "auth0|a" });
    const res = await create("auth0|a", {
      category: "inspector",
      company: "Acme Inspections",
    });
    expect(res.status).toBe(201);
    const v = (await res.json()) as ApiVendor;
    expect(v.contact_name).toBe("");
    expect(v.phone).toBe("");
    expect(v.email).toBe("");
    expect(v.website).toBe("");
    expect(v.notes).toBe("");
    expect(v.is_featured).toBe(false);
  });

  it("auto-increments sort_order within a category (0 then 1)", async () => {
    await createUser({ role: "agent", auth0_id: "auth0|a" });

    const first = (await (
      await create("auth0|a", { category: "lender", company: "First" })
    ).json()) as ApiVendor;
    const second = (await (
      await create("auth0|a", { category: "lender", company: "Second" })
    ).json()) as ApiVendor;
    // A different category restarts at 0.
    const other = (await (
      await create("auth0|a", { category: "title", company: "Other" })
    ).json()) as ApiVendor;

    expect(first.sort_order).toBe(0);
    expect(second.sort_order).toBe(1);
    expect(other.sort_order).toBe(0);
  });

  it("400 when category or company is missing", async () => {
    await createUser({ role: "agent", auth0_id: "auth0|a" });
    const noCompany = await create("auth0|a", { category: "lender" });
    expect(noCompany.status).toBe(400);
    const noCategory = await create("auth0|a", { company: "Acme" });
    expect(noCategory.status).toBe(400);
  });
});

describe("GET /vendors", () => {
  it("returns the caller's vendors ordered by category, sort_order", async () => {
    await createUser({ role: "agent", auth0_id: "auth0|a" });

    // Insert out of order; expect category asc, then sort_order asc.
    await create("auth0|a", { category: "lender", company: "Lender A" }); // sort 0
    await create("auth0|a", { category: "lender", company: "Lender B" }); // sort 1
    await create("auth0|a", { category: "inspector", company: "Inspector A" }); // sort 0

    const res = await listVendorsRoute(
      new Request("http://localhost/api/vendors", {
        headers: { authorization: await authHeader("auth0|a", ["agent"]) },
      })
    );
    expect(res.status).toBe(200);
    const list = (await res.json()) as ApiVendor[];
    expect(list.map((v) => `${v.category}/${v.company}/${v.sort_order}`)).toEqual([
      "inspector/Inspector A/0",
      "lender/Lender A/0",
      "lender/Lender B/1",
    ]);
  });

  it("does not return another agent's vendors (scoping)", async () => {
    await createUser({ role: "agent", auth0_id: "auth0|a" });
    await createUser({ role: "agent", auth0_id: "auth0|b" });

    await create("auth0|a", { category: "lender", company: "Mine" });
    await create("auth0|b", { category: "lender", company: "Theirs" });

    const res = await listVendorsRoute(
      new Request("http://localhost/api/vendors", {
        headers: { authorization: await authHeader("auth0|a", ["agent"]) },
      })
    );
    const list = (await res.json()) as ApiVendor[];
    expect(list).toHaveLength(1);
    expect(list[0].company).toBe("Mine");
  });
});

describe("PATCH /vendors/:id", () => {
  it("updates only the provided fields", async () => {
    await createUser({ role: "agent", auth0_id: "auth0|a" });
    const created = (await (
      await create("auth0|a", {
        category: "lender",
        company: "Original Co",
        phone: "111-1111",
        notes: "keep me",
      })
    ).json()) as ApiVendor;

    const res = await patchVendorRoute(
      new Request(`http://localhost/api/vendors/${created.id}`, {
        method: "PATCH",
        headers: {
          "content-type": "application/json",
          authorization: await authHeader("auth0|a", ["agent"]),
        },
        body: JSON.stringify({ company: "Renamed Co", is_featured: true }),
      }),
      ctx({ vendorId: created.id })
    );
    expect(res.status).toBe(200);
    const v = (await res.json()) as ApiVendor;
    expect(v.company).toBe("Renamed Co"); // changed
    expect(v.is_featured).toBe(true); // changed
    expect(v.phone).toBe("111-1111"); // untouched
    expect(v.notes).toBe("keep me"); // untouched
    expect(v.category).toBe("lender"); // untouched
  });

  it("403/404 when patching another agent's vendor", async () => {
    await createUser({ role: "agent", auth0_id: "auth0|a" });
    await createUser({ role: "agent", auth0_id: "auth0|b" });
    const mine = (await (
      await create("auth0|a", { category: "lender", company: "Mine" })
    ).json()) as ApiVendor;

    const res = await patchVendorRoute(
      new Request(`http://localhost/api/vendors/${mine.id}`, {
        method: "PATCH",
        headers: {
          "content-type": "application/json",
          authorization: await authHeader("auth0|b", ["agent"]),
        },
        body: JSON.stringify({ company: "Hijacked" }),
      }),
      ctx({ vendorId: mine.id })
    );
    expect(res.status).toBe(404);

    // Confirm it was not mutated.
    const list = (await (
      await listVendorsRoute(
        new Request("http://localhost/api/vendors", {
          headers: { authorization: await authHeader("auth0|a", ["agent"]) },
        })
      )
    ).json()) as ApiVendor[];
    expect(list[0].company).toBe("Mine");
  });
});

describe("DELETE /vendors/:id", () => {
  it("removes the caller's vendor", async () => {
    await createUser({ role: "agent", auth0_id: "auth0|a" });
    const v = (await (
      await create("auth0|a", { category: "lender", company: "Bye" })
    ).json()) as ApiVendor;

    const delRes = await deleteVendorRoute(
      new Request(`http://localhost/api/vendors/${v.id}`, {
        method: "DELETE",
        headers: { authorization: await authHeader("auth0|a", ["agent"]) },
      }),
      ctx({ vendorId: v.id })
    );
    expect(delRes.status).toBe(204);

    const list = (await (
      await listVendorsRoute(
        new Request("http://localhost/api/vendors", {
          headers: { authorization: await authHeader("auth0|a", ["agent"]) },
        })
      )
    ).json()) as ApiVendor[];
    expect(list).toHaveLength(0);
  });

  it("403/404 when deleting another agent's vendor", async () => {
    await createUser({ role: "agent", auth0_id: "auth0|a" });
    await createUser({ role: "agent", auth0_id: "auth0|b" });
    const mine = (await (
      await create("auth0|a", { category: "lender", company: "Mine" })
    ).json()) as ApiVendor;

    const res = await deleteVendorRoute(
      new Request(`http://localhost/api/vendors/${mine.id}`, {
        method: "DELETE",
        headers: { authorization: await authHeader("auth0|b", ["agent"]) },
      }),
      ctx({ vendorId: mine.id })
    );
    expect(res.status).toBe(404);

    // Still present for the owner.
    const list = (await (
      await listVendorsRoute(
        new Request("http://localhost/api/vendors", {
          headers: { authorization: await authHeader("auth0|a", ["agent"]) },
        })
      )
    ).json()) as ApiVendor[];
    expect(list).toHaveLength(1);
  });
});
