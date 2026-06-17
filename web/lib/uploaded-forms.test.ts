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
});

describe("buildTemplateSigners coordinate conversion", () => {
  it("converts PDF bottom-left rects to DocuSign top-left and groups by role + type", async () => {
    const doc = await PDFDocument.create();
    doc.addPage([612, 792]);
    const bytes = await doc.save();

    const signers = await buildTemplateSigners({
      pdfBytes: bytes,
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
