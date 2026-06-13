import { describe, it, expect } from "vitest";
import {
  assignTemplateRoles,
  deriveFallbackSigners,
  RoutingError,
  type DealPerson,
} from "@/lib/docusign-routing";

// Routing is pure over already-fetched rows so it unit-tests without mocks.
// The route layer loads deal participants + the agent and hands them in.

const BUYER: DealPerson = {
  userId: "u-buyer",
  name: "Mike Smith",
  email: "mike@example.com",
  role: "buyer",
};
const BUYER_2: DealPerson = {
  userId: "u-buyer2",
  name: "Alex Garcia",
  email: "alex@example.com",
  role: "buyer",
};
const SELLER: DealPerson = {
  userId: "u-seller",
  name: "Jennifer Williams",
  email: "jen@example.com",
  role: "seller",
};
const AGENT: DealPerson = {
  userId: "u-agent",
  name: "Sarah Johnson",
  email: "sarah@example.com",
  role: "agent",
};

describe("assignTemplateRoles (template path)", () => {
  it("fills template roles from deal people with embedded clientUserId (Stage 2)", () => {
    const roles = assignTemplateRoles({
      roleMapping: { buyer: "Buyer", agent: "Agent" },
      people: [BUYER, SELLER, AGENT],
    });
    expect(roles).toHaveLength(2);
    const buyerRole = roles.find((r) => r.roleName === "Buyer");
    expect(buyerRole).toMatchObject({
      roleName: "Buyer",
      name: "Mike Smith",
      email: "mike@example.com",
      userId: "u-buyer", // identity link for recipient rows / Stage 2
    });
    // Stage 2: portal users sign embedded — clientUserId rides the wire.
    expect(roles.every((r) => r.clientUserId === r.userId)).toBe(true);
    const agentRole = roles.find((r) => r.roleName === "Agent");
    expect(agentRole?.userId).toBe("u-agent");
    // Routing order comes from the template — never set here.
    expect(roles.every((r) => r.routingOrder === undefined)).toBe(true);
  });

  it("throws a clear error naming the template role no participant can fill", () => {
    expect(() =>
      assignTemplateRoles({
        roleMapping: { seller: "Seller", agent: "Agent" },
        people: [BUYER, AGENT], // no seller on the deal
      })
    ).toThrow(RoutingError);
    expect(() =>
      assignTemplateRoles({
        roleMapping: { seller: "Seller", agent: "Agent" },
        people: [BUYER, AGENT],
      })
    ).toThrow(/Seller/);
  });

  it("an override by user_id picks which participant fills a role", () => {
    const roles = assignTemplateRoles({
      roleMapping: { buyer: "Buyer" },
      people: [BUYER, BUYER_2],
      overrides: [{ role_name: "Buyer", user_id: "u-buyer2" }],
    });
    expect(roles[0]).toMatchObject({
      roleName: "Buyer",
      name: "Alex Garcia",
      userId: "u-buyer2",
    });
    expect(roles[0].clientUserId).toBe("u-buyer2");
  });

  it("an override by email/name creates an outside signer with no identity link", () => {
    const roles = assignTemplateRoles({
      roleMapping: { buyer: "Buyer", agent: "Agent" },
      people: [AGENT], // no buyer participant — the outside override fills it
      overrides: [
        { role_name: "Buyer", email: "outside@example.com", name: "Out Sider" },
      ],
    });
    const buyerRole = roles.find((r) => r.roleName === "Buyer");
    expect(buyerRole).toMatchObject({
      roleName: "Buyer",
      email: "outside@example.com",
      name: "Out Sider",
    });
    expect(buyerRole?.clientUserId).toBeUndefined();
    expect(buyerRole?.userId).toBeUndefined();
  });

  it("rejects an override whose user_id is not on the deal", () => {
    expect(() =>
      assignTemplateRoles({
        roleMapping: { buyer: "Buyer" },
        people: [BUYER],
        overrides: [{ role_name: "Buyer", user_id: "u-stranger" }],
      })
    ).toThrow(RoutingError);
  });
});

describe("deriveFallbackSigners (ad-hoc path)", () => {
  it("orders signers buyer -> seller -> agent with embedded clientUserId", () => {
    const signers = deriveFallbackSigners(
      [AGENT, SELLER, BUYER],
      ["u-agent", "u-seller", "u-buyer"]
    );
    expect(signers.map((s) => s.email)).toEqual([
      "mike@example.com", // buyer first
      "jen@example.com", // then seller
      "sarah@example.com", // agent last
    ]);
    expect(signers.map((s) => s.routingOrder)).toEqual([1, 2, 3]);
    expect(signers.map((s) => s.userId)).toEqual([
      "u-buyer",
      "u-seller",
      "u-agent",
    ]);
    // Stage 2: portal users sign embedded.
    expect(signers.every((s) => s.clientUserId === s.userId)).toBe(true);
  });

  it("only includes the selected people", () => {
    const signers = deriveFallbackSigners([AGENT, SELLER, BUYER], ["u-buyer"]);
    expect(signers).toHaveLength(1);
    expect(signers[0].email).toBe("mike@example.com");
  });

  it("throws when a selected id is not on the deal", () => {
    expect(() => deriveFallbackSigners([BUYER], ["u-stranger"])).toThrow(
      RoutingError
    );
  });
});
