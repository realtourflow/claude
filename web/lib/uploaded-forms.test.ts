import { describe, it, expect } from "vitest";
import { PDFDocument } from "pdf-lib";
import {
  deriveSigners,
  buildTemplateSigners,
  type ApprovedFieldRow,
} from "@/lib/uploaded-forms";

function field(o: Partial<ApprovedFieldRow>): ApprovedFieldRow {
  return {
    detected_name: "f",
    detected_type: "text",
    page_number: 1,
    pos_x: 0,
    pos_y: 0,
    width: 0,
    height: 0,
    ai_core_key: null,
    ai_role: null,
    final_core_key: null,
    final_role: null,
    final_type: null,
    decision: "pending",
    ...o,
  };
}

describe("deriveSigners", () => {
  it("builds a by-role mapping from the roles used, normalized", () => {
    const s = deriveSigners(
      [
        field({ ai_role: "Buyer" }), // untouched → AI role
        field({ final_role: "Listing Agent", decision: "corrected" }),
      ],
      "buy"
    );
    expect(s.routing).toBe("by-role");
    expect(s.roleMapping).toMatchObject({ buyer: "Buyer", agent: "Listing Agent" });
  });

  it("falls back to a side-based role when none are assigned", () => {
    expect(deriveSigners([field({})], "sell").roleMapping).toEqual({
      seller: "Seller",
    });
  });

  // Issue #192 case 1: BuyerAgent and Buyer2 must each get their own signer —
  // the old normalize order collapsed BuyerAgent→buyer and Buyer2→buyer.
  it("keeps BuyerAgent and Buyer2 as distinct signers on a multi-signer form", () => {
    const s = deriveSigners(
      [
        field({ ai_role: "Buyer1" }),
        field({ ai_role: "Buyer2" }),
        field({ ai_role: "BuyerAgent" }),
        field({ ai_role: "Seller1" }),
      ],
      "buy"
    );
    // One entry per DISTINCT template role — nothing collapsed.
    expect(Object.values(s.roleMapping).sort()).toEqual([
      "Buyer1",
      "Buyer2",
      "BuyerAgent",
      "Seller1",
    ]);
    // Agent substring wins over buyer; duplicates get numeric suffixes.
    expect(s.roleMapping).toEqual({
      buyer: "Buyer1",
      buyer2: "Buyer2",
      agent: "BuyerAgent",
      seller: "Seller1",
    });
  });

  // Issue #192 case 2: SellerAgent is an agent signer, never a seller.
  it("maps SellerAgent to a distinct agent signer, not seller", () => {
    const s = deriveSigners(
      [field({ ai_role: "Seller1" }), field({ ai_role: "SellerAgent" })],
      "sell"
    );
    expect(s.roleMapping).toEqual({ seller: "Seller1", agent: "SellerAgent" });
  });

  it("suffixes a second agent role; the form's own side claims the bare agent key", () => {
    // Buy-side form: BuyerAgent is the deal's own agent even when SellerAgent
    // appears first in the field order.
    const s = deriveSigners(
      [
        field({ ai_role: "SellerAgent" }),
        field({ ai_role: "BuyerAgent" }),
        field({ ai_role: "Buyer1" }),
      ],
      "buy"
    );
    expect(s.roleMapping).toEqual({
      agent: "BuyerAgent",
      agent2: "SellerAgent",
      buyer: "Buyer1",
    });
  });

  // Issue #192 case 3: the simple two-party form derives exactly as before.
  it("leaves a simple buyer+seller form unchanged", () => {
    const s = deriveSigners(
      [field({ ai_role: "Buyer" }), field({ ai_role: "Seller" })],
      "buy"
    );
    expect(s.routing).toBe("by-role");
    expect(s.roleMapping).toEqual({ buyer: "Buyer", seller: "Seller" });
  });
});

describe("buildTemplateSigners coordinate conversion", () => {
  it("converts PDF bottom-left rects to DocuSign top-left and groups by role + type", async () => {
    const doc = await PDFDocument.create();
    doc.addPage([612, 792]);
    const bytes = await doc.save();

    const signers = await buildTemplateSigners({
      pdfBytes: bytes,
      side: "buy",
      roleMapping: { buyer: "Buyer", agent: "Agent" },
      fields: [
        field({
          detected_name: "buyer_name",
          final_core_key: "buyer_name",
          final_role: "Buyer",
          final_type: "text",
          decision: "corrected",
          pos_x: 72,
          pos_y: 700,
          width: 200,
          height: 18,
        }),
        field({
          detected_name: "buyer_sig",
          final_role: "Buyer",
          final_type: "signature",
          decision: "corrected",
          pos_x: 72,
          pos_y: 100,
          width: 120,
          height: 20,
        }),
        field({
          detected_name: "agent_init",
          final_role: "Agent",
          final_type: "initial",
          decision: "corrected",
          pos_x: 400,
          pos_y: 100,
          width: 40,
          height: 20,
        }),
      ],
    });

    const buyer = signers.find((s) => s.roleName === "Buyer")!;
    const agent = signers.find((s) => s.roleName === "Agent")!;

    // text tab: label = core key; y = 792 - 700 - 18 = 74; carries a box.
    expect(buyer.textTabs).toHaveLength(1);
    expect(buyer.textTabs![0]).toMatchObject({
      tabLabel: "buyer_name",
      pageNumber: 1,
      x: 72,
      y: 74,
      width: 200,
      height: 18,
    });
    // signature on Buyer: y = 792 - 100 - 20 = 672.
    expect(buyer.signHereTabs).toHaveLength(1);
    expect(buyer.signHereTabs![0]).toMatchObject({ tabLabel: "buyer_sig", x: 72, y: 672 });
    // initial routed to the Agent signer.
    expect(agent.initialHereTabs).toHaveLength(1);
    expect(agent.initialHereTabs![0]).toMatchObject({ tabLabel: "agent_init", x: 400, y: 672 });
  });
});

describe("buildTemplateSigners multi-signer routing (issue #192)", () => {
  async function onePagePdf() {
    const doc = await PDFDocument.create();
    doc.addPage([612, 792]);
    return doc.save();
  }

  it("gives Buyer2 and BuyerAgent their own recipients with their own tabs", async () => {
    const bytes = await onePagePdf();
    const fields = [
      field({ detected_name: "buyer1_sig", ai_role: "Buyer1", ai_core_key: null, detected_type: "signature" }),
      field({ detected_name: "buyer2_sig", ai_role: "Buyer2", detected_type: "signature" }),
      field({ detected_name: "buyer_agent_sig", ai_role: "BuyerAgent", detected_type: "signature" }),
      field({ detected_name: "seller_sig", ai_role: "Seller1", detected_type: "signature" }),
    ];
    const signers = await buildTemplateSigners({
      pdfBytes: bytes,
      side: "buy",
      fields,
      roleMapping: deriveSigners(fields, "buy").roleMapping,
    });

    // One recipient per distinct template role.
    expect(signers.map((s) => s.roleName).sort()).toEqual([
      "Buyer1",
      "Buyer2",
      "BuyerAgent",
      "Seller1",
    ]);
    // Every signature tab lands on ITS role's recipient — none dumped on Buyer1.
    for (const name of ["Buyer1", "Buyer2", "BuyerAgent", "Seller1"]) {
      const s = signers.find((x) => x.roleName === name)!;
      expect(s.signHereTabs).toHaveLength(1);
    }
    expect(
      signers.find((s) => s.roleName === "BuyerAgent")!.signHereTabs![0].tabLabel
    ).toBe("buyer_agent_sig");
    // Distinct recipientIds / routing orders.
    expect(new Set(signers.map((s) => s.recipientId)).size).toBe(4);
  });

  it("follows an admin rename of a role through to the tabs", async () => {
    const bytes = await onePagePdf();
    const fields = [
      field({ detected_name: "b_sig", ai_role: "Buyer1", detected_type: "signature" }),
      field({ detected_name: "ba_sig", ai_role: "BuyerAgent", detected_type: "signature" }),
    ];
    // Admin renamed the template role names before approving.
    const signers = await buildTemplateSigners({
      pdfBytes: bytes,
      side: "buy",
      fields,
      roleMapping: { buyer: "Purchaser", agent: "Selling Agent" },
    });
    expect(signers.map((s) => s.roleName).sort()).toEqual([
      "Purchaser",
      "Selling Agent",
    ]);
    expect(
      signers.find((s) => s.roleName === "Selling Agent")!.signHereTabs![0].tabLabel
    ).toBe("ba_sig");
  });

  it("creates a distinct signer for a field role missing from the mapping instead of dumping its tabs on the first signer", async () => {
    const bytes = await onePagePdf();
    const fields = [
      field({ detected_name: "b_sig", ai_role: "Buyer1", detected_type: "signature" }),
      field({ detected_name: "w_sig", ai_role: "Witness", detected_type: "signature" }),
    ];
    const signers = await buildTemplateSigners({
      pdfBytes: bytes,
      side: "buy",
      fields,
      roleMapping: { buyer: "Buyer1" }, // stale/partial mapping missing Witness
    });
    const witness = signers.find((s) => s.roleName === "Witness");
    expect(witness).toBeDefined();
    expect(witness!.signHereTabs).toHaveLength(1);
    expect(signers.find((s) => s.roleName === "Buyer1")!.signHereTabs).toHaveLength(1);
  });

  it("still routes role-less fields to the first signer", async () => {
    const bytes = await onePagePdf();
    const fields = [
      field({ detected_name: "note", ai_role: null, detected_type: "text" }),
      field({ detected_name: "b_sig", ai_role: "Buyer", detected_type: "signature" }),
    ];
    const signers = await buildTemplateSigners({
      pdfBytes: bytes,
      side: "buy",
      fields,
      roleMapping: { buyer: "Buyer" },
    });
    expect(signers).toHaveLength(1);
    expect(signers[0].textTabs).toHaveLength(1);
    expect(signers[0].signHereTabs).toHaveLength(1);
  });
});
