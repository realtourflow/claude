/**
 * Regression test for issue #85 — dashboard pipeline totals concatenated
 * instead of summing.
 *
 * The deal SELECTs (lib/deals.ts, app/api/deals/route.ts, app/api/me/deals)
 * cast Postgres DECIMAL columns to text — `price::text`, `commission_pct::text`
 * — so on the wire they are strings like "450000.00". ApiDeal must declare
 * them as strings and apiDealToFrontend must parse them to numbers, otherwise
 * `reduce((s, d) => s + d.property.price, 0)` in AdminDashboard /
 * AgentDashboard string-concatenates ("0450000.00") instead of summing.
 *
 * DB-free: exercises only the exported adapter.
 */
import { describe, it, expect } from "vitest";
import { apiDealToFrontend, type ApiDeal } from "@/hooks/useDeals";

function wireDeal(overrides: Partial<ApiDeal> = {}): ApiDeal {
  return {
    id: "00000000-0000-0000-0000-000000000001",
    agent_id: "00000000-0000-0000-0000-000000000002",
    type: "buy",
    stage: "active_search",
    health: "green",
    title: "Smith — Buy",
    address: "123 Main St",
    price: null,
    arive_linked: false,
    created_at: "2026-06-01T00:00:00.000Z",
    updated_at: "2026-06-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("apiDealToFrontend numeric parsing (#85)", () => {
  it("parses wire price text '450000.00' into the number 450000", () => {
    const deal = apiDealToFrontend(wireDeal({ price: "450000.00" }));
    expect(typeof deal.property.price).toBe("number");
    expect(deal.property.price).toBe(450000);
  });

  it("maps null and empty-string price to 0 — the client Deal.property.price is a plain number with 0 as the TBD sentinel", () => {
    expect(apiDealToFrontend(wireDeal({ price: null })).property.price).toBe(0);
    expect(apiDealToFrontend(wireDeal({ price: "" })).property.price).toBe(0);
  });

  it("dashboard volume reduce sums to a number — never a concatenated string", () => {
    const deals = [
      apiDealToFrontend(wireDeal({ price: "450000.00" })),
      apiDealToFrontend(
        wireDeal({ id: "00000000-0000-0000-0000-000000000003", price: null }),
      ),
    ];
    const total = deals.reduce((s, d) => s + d.property.price, 0);
    expect(typeof total).toBe("number");
    expect(total).toBe(450000);
  });

  it("parses commission_pct '2.50' into 2.5 and computes a numeric estimatedCommission", () => {
    const deal = apiDealToFrontend(
      wireDeal({ price: "450000.00", commission_pct: "2.50" }),
    );
    expect(deal.commissionPct).toBe(2.5);
    expect(deal.estimatedCommission).toBe(11250);
  });

  it("defaults commissionPct to 3 when commission_pct is absent from the wire", () => {
    const deal = apiDealToFrontend(wireDeal({ price: "100000" }));
    expect(deal.commissionPct).toBe(3);
    expect(deal.estimatedCommission).toBe(3000);
  });

  it("treats garbage and whitespace-only numerics as absent — client defaults apply", () => {
    expect(apiDealToFrontend(wireDeal({ price: "abc" })).property.price).toBe(0);
    expect(apiDealToFrontend(wireDeal({ price: "  " })).property.price).toBe(0);
    expect(
      apiDealToFrontend(wireDeal({ price: "100000", commission_pct: "abc" }))
        .commissionPct,
    ).toBe(3);
  });
});

describe("daysInStage anchors to stage entry, not updated_at (#257)", () => {
  it("computes daysInStage from stage_entered_at even when updated_at is 'now'", () => {
    const fiveDaysAgo = new Date(Date.now() - 5 * 86_400_000).toISOString();
    // updated_at = now simulates an unrelated write (note edit, fee, ARIVE sync)
    // that bumped it. The count must still read 5, not reset to 0.
    const deal = apiDealToFrontend(
      wireDeal({ stage_entered_at: fiveDaysAgo, updated_at: new Date().toISOString() }),
    );
    expect(deal.timeline.daysInStage).toBe(5);
  });

  it("falls back to created_at when stage_entered_at is absent from the wire", () => {
    const threeDaysAgo = new Date(Date.now() - 3 * 86_400_000).toISOString();
    // e.g. the POST /deals create response carries no stage_entered_at — a
    // brand-new deal's stage entry IS its creation, so created_at anchors it.
    const deal = apiDealToFrontend(
      wireDeal({ created_at: threeDaysAgo, updated_at: new Date().toISOString() }),
    );
    expect(deal.timeline.daysInStage).toBe(3);
  });

  it("never goes negative when the anchor is in the future", () => {
    const tomorrow = new Date(Date.now() + 86_400_000).toISOString();
    expect(
      apiDealToFrontend(wireDeal({ stage_entered_at: tomorrow })).timeline.daysInStage,
    ).toBe(0);
  });
});
