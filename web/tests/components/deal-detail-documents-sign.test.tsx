// @vitest-environment happy-dom
/**
 * DocumentsTab (DealDetail) — the OWNING AGENT's embedded-sign affordance
 * (issue #165).
 *
 * Templates like the Buyer Agency Agreement route the agent as a required
 * embedded recipient (clientUserId, no DocuSign email). The agent must be
 * able to sign from the deal's Documents tab: a Sign button that mints the
 * single-use recipient-view URL via the existing signing-url route and
 * full-page-redirects into DocuSign — the same pattern the buyer/seller
 * portal (PortalDealDocuments) already uses — plus the signing_complete
 * return flow (?signed_doc=<id>&event=signing_complete → banner + refresh).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DocumentsTab } from "@/components/pages/agent/DealDetail";
import type { Deal } from "@/lib/data/mockDeals";
import type { Document as ApiDocument } from "@/hooks/useDocuments";

const getSigningUrl = vi.fn();
const refreshDocuSignStatus = vi.fn();
vi.mock("@/hooks/useDocuments", () => ({
  useDocuments: vi.fn(() => ({
    docs: [],
    loading: false,
    error: null,
    refresh: vi.fn(),
  })),
  requestUploadUrl: vi.fn(),
  confirmUpload: vi.fn(),
  getDownloadUrl: vi.fn(),
  deleteDocument: vi.fn(),
  sendForSignatureByUserIds: vi.fn(),
  getSigningUrl: (...a: unknown[]) => getSigningUrl(...a),
  refreshDocuSignStatus: (...a: unknown[]) => refreshDocuSignStatus(...a),
  setDisclosuresComplete: vi.fn(),
}));

const DEAL = {
  id: "deal-1",
  stage: "intake",
  type: "buy",
  disclosuresComplete: false,
} as unknown as Deal;

function doc(overrides: Partial<ApiDocument> = {}): ApiDocument {
  return {
    id: "d1",
    dealId: "deal-1",
    uploadedBy: "u",
    uploaderName: "Paula Agent",
    name: "Buyer Agency Agreement",
    s3Key: "",
    mimeType: "application/pdf",
    fileSize: 0,
    createdAt: "2026-06-12T00:00:00Z",
    docusignStatus: "sent",
    myRecipientStatus: "sent",
    ...overrides,
  };
}

const onRefresh = vi.fn();

function renderTab(docs: ApiDocument[]) {
  return render(
    <DocumentsTab deal={DEAL} docs={docs} loading={false} onRefresh={onRefresh} />
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  window.history.replaceState(null, "", "/agent/deals/deal-1");
  getSigningUrl.mockResolvedValue("https://demo.docusign.net/signing/agent-1");
});

describe("DocumentsTab agent embedded signing (#165)", () => {
  it("shows a Sign button for the agent's pending recipient and redirects into DocuSign", async () => {
    const assignSpy = vi
      .spyOn(window.location, "assign")
      .mockImplementation(() => {});
    const user = userEvent.setup();
    renderTab([doc()]);

    await user.click(screen.getByRole("button", { name: /^sign$/i }));
    await waitFor(() =>
      expect(getSigningUrl).toHaveBeenCalledWith("deal-1", "d1")
    );
    expect(assignSpy).toHaveBeenCalledWith(
      "https://demo.docusign.net/signing/agent-1"
    );
  });

  it("shows the Sign button for a delivered (viewed) recipient too", () => {
    renderTab([doc({ myRecipientStatus: "delivered", docusignStatus: "delivered" })]);
    expect(screen.getByRole("button", { name: /^sign$/i })).toBeInTheDocument();
  });

  it("hides the Sign button when the agent is not a pending signer", () => {
    renderTab([
      doc({ myRecipientStatus: null }),
      doc({ id: "d2", myRecipientStatus: "completed", docusignStatus: "completed" }),
      doc({ id: "d3", myRecipientStatus: "declined", docusignStatus: "declined" }),
      doc({ id: "d4", docusignStatus: undefined, myRecipientStatus: null }),
    ]);
    expect(
      screen.queryByRole("button", { name: /^sign$/i })
    ).not.toBeInTheDocument();
  });

  it("surfaces the 409 inbox hint when the recipient is email-based", async () => {
    getSigningUrl.mockRejectedValue(
      new Error("409 — this document was sent to your email")
    );
    const user = userEvent.setup();
    renderTab([doc()]);

    await user.click(screen.getByRole("button", { name: /^sign$/i }));
    expect(await screen.findByText(/sent to your email/i)).toBeInTheDocument();
  });

  it("the signing_complete return refreshes status and shows the banner", async () => {
    refreshDocuSignStatus.mockResolvedValue({ status: "completed" });
    window.history.replaceState(
      null,
      "",
      "/agent/deals/deal-1?signed_doc=d1&event=signing_complete"
    );
    renderTab([doc({ myRecipientStatus: "completed" })]);

    expect(await screen.findByText(/signature recorded/i)).toBeInTheDocument();
    await waitFor(() =>
      expect(refreshDocuSignStatus).toHaveBeenCalledWith("deal-1", "d1")
    );
    await waitFor(() => expect(onRefresh).toHaveBeenCalled());
    // Params stripped so a reload doesn't repeat the flow.
    expect(window.location.search).toBe("");
  });
});
