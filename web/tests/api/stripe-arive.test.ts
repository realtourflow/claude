import { describe, it, expect, beforeAll, beforeEach, afterEach } from "vitest";
import type Stripe from "stripe";
import { POST as checkoutRoute } from "@/app/api/deals/[id]/fee/checkout/route";
import { POST as waiveRoute } from "@/app/api/deals/[id]/fee/waive/route";
import { POST as stripeWebhook } from "@/app/api/stripe/webhook/route";
import { PATCH as linkAriveRoute } from "@/app/api/deals/[id]/arive/route";
import { POST as syncAriveRoute } from "@/app/api/deals/[id]/arive/sync/route";
import { POST as ariveWebhook } from "@/app/api/arive/webhook/route";
import { setVerifyOptionsForTesting } from "@/lib/auth";
import { setStripeForTesting } from "@/lib/stripe";
import { setAriveForTesting, type AriveClient } from "@/lib/arive";
import { prisma } from "@/lib/db";
import { authHeader, getTestSigner } from "../helpers/jwt";
import { truncateAll } from "../helpers/db";
import { createUser, createDeal } from "../helpers/factories";

beforeAll(async () => {
  const { verifyOpts } = await getTestSigner();
  setVerifyOptionsForTesting(verifyOpts);
});

afterEach(() => {
  setStripeForTesting(undefined);
  setAriveForTesting(undefined);
});

beforeEach(async () => {
  await truncateAll();
});

function ctx(id: string) {
  return { params: Promise.resolve({ id }) };
}

describe("POST /api/deals/[id]/fee/checkout", () => {
  it("creates a session and marks the deal pending", async () => {
    const agent = await createUser({ role: "agent", auth0_id: "auth0|a" });
    const deal = await createDeal({ agent_id: agent.id, title: "Test Deal" });

    setStripeForTesting({
      checkout: {
        sessions: {
          create: async () => ({
            id: "cs_test_123",
            url: "https://stripe.test/checkout/cs_test_123",
          }),
        },
      },
      webhooks: {
        constructEvent: () => {
          throw new Error("not used");
        },
      },
    });

    const req = new Request(
      `http://localhost/api/deals/${deal.id}/fee/checkout`,
      {
        method: "POST",
        headers: { authorization: await authHeader("auth0|a", ["agent"]) },
      }
    );
    const res = await checkoutRoute(req, ctx(deal.id));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { checkout_url: string };
    expect(body.checkout_url).toBe("https://stripe.test/checkout/cs_test_123");

    const row = await prisma.deals.findUnique({ where: { id: deal.id } });
    expect(row?.fee_status).toBe("pending");
    expect(row?.fee_checkout_session_id).toBe("cs_test_123");
  });

  it("409 when fee already paid or waived", async () => {
    const agent = await createUser({ role: "agent", auth0_id: "auth0|a" });
    const deal = await createDeal({ agent_id: agent.id });
    await prisma.deals.update({
      where: { id: deal.id },
      data: { fee_status: "paid" },
    });
    setStripeForTesting({
      checkout: { sessions: { create: async () => ({ id: "x", url: null }) } },
      webhooks: { constructEvent: () => ({} as Stripe.Event) },
    });
    const req = new Request(
      `http://localhost/api/deals/${deal.id}/fee/checkout`,
      {
        method: "POST",
        headers: { authorization: await authHeader("auth0|a", ["agent"]) },
      }
    );
    const res = await checkoutRoute(req, ctx(deal.id));
    expect(res.status).toBe(409);
  });

  it("403 when not owner", async () => {
    const agent = await createUser({ role: "agent" });
    const other = await createUser({ role: "agent", auth0_id: "auth0|o" });
    const deal = await createDeal({ agent_id: agent.id });
    void other;
    setStripeForTesting({
      checkout: { sessions: { create: async () => ({ id: "x", url: null }) } },
      webhooks: { constructEvent: () => ({} as Stripe.Event) },
    });
    const req = new Request(
      `http://localhost/api/deals/${deal.id}/fee/checkout`,
      {
        method: "POST",
        headers: { authorization: await authHeader("auth0|o", ["agent"]) },
      }
    );
    const res = await checkoutRoute(req, ctx(deal.id));
    expect(res.status).toBe(403);
  });
});

describe("POST /api/deals/[id]/fee/waive", () => {
  it("admin can waive; status set to waived; non-admin gets 403", async () => {
    const agent = await createUser({ role: "agent" });
    const deal = await createDeal({ agent_id: agent.id });

    // Non-admin agent
    const denied = await waiveRoute(
      new Request(`http://localhost/api/deals/${deal.id}/fee/waive`, {
        method: "POST",
        headers: { authorization: await authHeader("auth0|a", ["agent"]) },
      }),
      ctx(deal.id)
    );
    expect(denied.status).toBe(403);

    // Admin succeeds
    await createUser({ role: "admin", auth0_id: "auth0|admin" });
    const allowed = await waiveRoute(
      new Request(`http://localhost/api/deals/${deal.id}/fee/waive`, {
        method: "POST",
        headers: { authorization: await authHeader("auth0|admin", ["admin"]) },
      }),
      ctx(deal.id)
    );
    expect(allowed.status).toBe(200);
    const row = await prisma.deals.findUnique({ where: { id: deal.id } });
    expect(row?.fee_status).toBe("waived");
  });
});

describe("POST /api/stripe/webhook", () => {
  // Injects a checkout.session.completed event with the given session shape.
  function setSessionCompleted(session: Record<string, unknown>) {
    setStripeForTesting({
      checkout: { sessions: { create: async () => ({ id: "x", url: null }) } },
      webhooks: {
        constructEvent: () =>
          ({
            type: "checkout.session.completed",
            data: { object: session as unknown as Stripe.Checkout.Session },
          }) as unknown as Stripe.Event,
      },
    });
  }

  function webhookReq() {
    return new Request("http://localhost/api/stripe/webhook", {
      method: "POST",
      headers: { "stripe-signature": "t=fake,v1=fake" },
      body: "{}",
    });
  }

  it("checkout.session.completed marks deal paid", async () => {
    const agent = await createUser({ role: "agent" });
    const deal = await createDeal({ agent_id: agent.id });

    setStripeForTesting({
      checkout: { sessions: { create: async () => ({ id: "x", url: null }) } },
      webhooks: {
        constructEvent: () =>
          ({
            type: "checkout.session.completed",
            data: {
              object: {
                id: "cs_test_999",
                payment_status: "paid",
                metadata: { deal_id: deal.id, type: "closing_fee" },
              } as unknown as Stripe.Checkout.Session,
            },
          }) as unknown as Stripe.Event,
      },
    });

    const req = new Request("http://localhost/api/stripe/webhook", {
      method: "POST",
      headers: { "stripe-signature": "t=fake,v1=fake" },
      body: JSON.stringify({ test: true }),
    });
    const res = await stripeWebhook(req);
    expect(res.status).toBe(200);

    const row = await prisma.deals.findUnique({ where: { id: deal.id } });
    expect(row?.fee_status).toBe("paid");
    expect(row?.fee_paid_at).not.toBeNull();
  });

  it("smooth_exit_upsell payment sets upsells_paid and does NOT touch the closing fee", async () => {
    const agent = await createUser({ role: "agent" });
    const deal = await createDeal({ agent_id: agent.id });
    // Seed an enrollment the way POST /deals/[id]/smoothexit persists it.
    await prisma.deals.update({
      where: { id: deal.id },
      data: {
        smooth_exit: {
          status: "active",
          payment_option: "from_proceeds",
          selected_upsells: ["staging"],
          upsell_total_cents: 25000,
          upsells_paid: false,
          enrolled_at: new Date().toISOString(),
        },
      },
    });

    setSessionCompleted({
      id: "cs_upsell_1",
      payment_status: "paid",
      metadata: { deal_id: deal.id, type: "smooth_exit_upsell" },
    });
    const res = await stripeWebhook(webhookReq());
    expect(res.status).toBe(200);

    const rows = await prisma.$queryRaw<
      {
        status: string;
        upsells_paid: boolean;
        session_id: string | null;
        paid_at: string | null;
      }[]
    >`
      SELECT smooth_exit->>'status'                        AS status,
             (smooth_exit->>'upsells_paid')::boolean       AS upsells_paid,
             smooth_exit->>'upsells_checkout_session_id'   AS session_id,
             smooth_exit->>'upsells_paid_at'               AS paid_at
      FROM deals WHERE id = ${deal.id}::uuid
    `;
    expect(rows[0].upsells_paid).toBe(true);
    expect(rows[0].session_id).toBe("cs_upsell_1");
    expect(rows[0].paid_at).toBeTruthy();
    // Sibling enrollment fields survive the merge.
    expect(rows[0].status).toBe("active");

    // The closing fee must be untouched by an upsell payment.
    const row = await prisma.deals.findUnique({ where: { id: deal.id } });
    expect(row?.fee_status).toBe("unpaid");
    expect(row?.fee_checkout_session_id).toBeNull();
    expect(row?.fee_paid_at).toBeNull();
  });

  it("payment_status !== 'paid' changes nothing", async () => {
    const agent = await createUser({ role: "agent" });
    const deal = await createDeal({ agent_id: agent.id });
    setSessionCompleted({
      id: "cs_async_1",
      payment_status: "unpaid",
      metadata: { deal_id: deal.id, type: "closing_fee" },
    });
    const res = await stripeWebhook(webhookReq());
    expect(res.status).toBe(200);

    const row = await prisma.deals.findUnique({ where: { id: deal.id } });
    expect(row?.fee_status).toBe("unpaid");
    expect(row?.fee_checkout_session_id).toBeNull();
    expect(row?.fee_paid_at).toBeNull();
  });

  it("unknown or missing session type is a no-op", async () => {
    const agent = await createUser({ role: "agent" });
    const deal = await createDeal({ agent_id: agent.id });
    setSessionCompleted({
      id: "cs_untyped_1",
      payment_status: "paid",
      metadata: { deal_id: deal.id },
    });
    const res = await stripeWebhook(webhookReq());
    expect(res.status).toBe(200);

    const row = await prisma.deals.findUnique({ where: { id: deal.id } });
    expect(row?.fee_status).toBe("unpaid");
    expect(row?.fee_paid_at).toBeNull();
    expect(row?.smooth_exit).toBeNull();
  });

  it("invalid signature returns 400", async () => {
    setStripeForTesting({
      checkout: { sessions: { create: async () => ({ id: "x", url: null }) } },
      webhooks: {
        constructEvent: () => {
          throw new Error("bad signature");
        },
      },
    });
    const req = new Request("http://localhost/api/stripe/webhook", {
      method: "POST",
      headers: { "stripe-signature": "bad" },
      body: "{}",
    });
    const res = await stripeWebhook(req);
    expect(res.status).toBe(400);
  });

  it("does NOT mark waived deals as paid", async () => {
    const agent = await createUser({ role: "agent" });
    const deal = await createDeal({ agent_id: agent.id });
    await prisma.deals.update({
      where: { id: deal.id },
      data: { fee_status: "waived" },
    });
    setStripeForTesting({
      checkout: { sessions: { create: async () => ({ id: "x", url: null }) } },
      webhooks: {
        constructEvent: () =>
          ({
            type: "checkout.session.completed",
            data: {
              object: {
                id: "cs_x",
                payment_status: "paid",
                // type must be closing_fee so this exercises the waived
                // guard, not the unknown-type no-op.
                metadata: { deal_id: deal.id, type: "closing_fee" },
              } as unknown as Stripe.Checkout.Session,
            },
          }) as unknown as Stripe.Event,
      },
    });
    const req = new Request("http://localhost/api/stripe/webhook", {
      method: "POST",
      headers: { "stripe-signature": "ok" },
      body: "{}",
    });
    await stripeWebhook(req);
    const row = await prisma.deals.findUnique({ where: { id: deal.id } });
    expect(row?.fee_status).toBe("waived");
  });
});

describe("ARIVE link + sync + webhook", () => {
  function fakeAriveClient(enabled = true): AriveClient {
    return {
      enabled: () => enabled,
      fetchLoan: async (loanId: string) => ({
        loanId,
        status: "active",
        milestones: { contract: true },
        keyDates: { closing: "2026-06-15" },
      }),
    };
  }

  it("PATCH /deals/[id]/arive links and stores loan ID", async () => {
    const agent = await createUser({ role: "agent", auth0_id: "auth0|a" });
    const deal = await createDeal({ agent_id: agent.id });
    setAriveForTesting(fakeAriveClient());

    const req = new Request(`http://localhost/api/deals/${deal.id}/arive`, {
      method: "PATCH",
      headers: {
        "content-type": "application/json",
        authorization: await authHeader("auth0|a", ["agent"]),
      },
      body: JSON.stringify({ arive_loan_id: "loan-abc-123" }),
    });
    const res = await linkAriveRoute(req, ctx(deal.id));
    expect(res.status).toBe(200);
    const row = await prisma.deals.findUnique({ where: { id: deal.id } });
    expect(row?.arive_loan_id).toBe("loan-abc-123");
    expect(row?.arive_linked).toBe(true);
  });

  it("POST /deals/[id]/arive/sync writes back loan data", async () => {
    const agent = await createUser({ role: "agent", auth0_id: "auth0|a" });
    const deal = await createDeal({ agent_id: agent.id });
    await prisma.deals.update({
      where: { id: deal.id },
      data: { arive_loan_id: "loan-xyz", arive_linked: true },
    });
    setAriveForTesting(fakeAriveClient());

    const req = new Request(`http://localhost/api/deals/${deal.id}/arive/sync`, {
      method: "POST",
      headers: { authorization: await authHeader("auth0|a", ["agent"]) },
    });
    const res = await syncAriveRoute(req, ctx(deal.id));
    expect(res.status).toBe(200);
    const row = await prisma.deals.findUnique({ where: { id: deal.id } });
    expect(row?.arive_loan_status).toBe("active");
    expect(row?.arive_milestones).toEqual({ contract: true });
    expect(row?.arive_key_dates).toEqual({ closing: "2026-06-15" });
    expect(row?.arive_synced_at).not.toBeNull();
  });

  it("sync surfaces a 5xx and writes nothing when fetchLoan throws", async () => {
    const agent = await createUser({ role: "agent", auth0_id: "auth0|a" });
    const deal = await createDeal({ agent_id: agent.id });
    await prisma.deals.update({
      where: { id: deal.id },
      data: { arive_loan_id: "loan-boom", arive_linked: true },
    });
    // A non-2xx ARIVE response makes the real client throw; assert the route
    // surfaces a 5xx and never writes a phantom "unknown" status.
    setAriveForTesting({
      enabled: () => true,
      fetchLoan: async () => {
        throw new Error("arive get loan loan-boom: status 500");
      },
    });
    const req = new Request(`http://localhost/api/deals/${deal.id}/arive/sync`, {
      method: "POST",
      headers: { authorization: await authHeader("auth0|a", ["agent"]) },
    });
    const res = await syncAriveRoute(req, ctx(deal.id));
    expect(res.status).toBeGreaterThanOrEqual(500);
    const row = await prisma.deals.findUnique({ where: { id: deal.id } });
    expect(row?.arive_loan_status).toBeNull();
    expect(row?.arive_synced_at).toBeNull();
  });

  it("sync returns 400 when deal not linked", async () => {
    const agent = await createUser({ role: "agent", auth0_id: "auth0|a" });
    const deal = await createDeal({ agent_id: agent.id });
    setAriveForTesting(fakeAriveClient());
    const req = new Request(`http://localhost/api/deals/${deal.id}/arive/sync`, {
      method: "POST",
      headers: { authorization: await authHeader("auth0|a", ["agent"]) },
    });
    const res = await syncAriveRoute(req, ctx(deal.id));
    expect(res.status).toBe(400);
  });

  it("sync returns 503 when client disabled (no config)", async () => {
    const agent = await createUser({ role: "agent", auth0_id: "auth0|a" });
    const deal = await createDeal({ agent_id: agent.id });
    await prisma.deals.update({
      where: { id: deal.id },
      data: { arive_loan_id: "loan-z", arive_linked: true },
    });
    setAriveForTesting(fakeAriveClient(false));
    const req = new Request(`http://localhost/api/deals/${deal.id}/arive/sync`, {
      method: "POST",
      headers: { authorization: await authHeader("auth0|a", ["agent"]) },
    });
    const res = await syncAriveRoute(req, ctx(deal.id));
    expect(res.status).toBe(503);
  });

  it("webhook 200s immediately and (best-effort) updates deal", async () => {
    const agent = await createUser({ role: "agent" });
    const deal = await createDeal({ agent_id: agent.id });
    await prisma.deals.update({
      where: { id: deal.id },
      data: { arive_loan_id: "loan-hook", arive_linked: true },
    });
    setAriveForTesting(fakeAriveClient());
    const req = new Request("http://localhost/api/arive/webhook", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ loanId: "loan-hook" }),
    });
    const res = await ariveWebhook(req);
    expect(res.status).toBe(200);
  });
});
