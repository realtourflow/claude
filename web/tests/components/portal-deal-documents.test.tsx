// @vitest-environment happy-dom
/**
 * PortalDealDocuments — the shared buyer/seller documents tab with embedded
 * signing: status badges, the "Sign this document" entry point (full-page
 * redirect into DocuSign), and the signing_complete return flow.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import PortalDealDocuments from "@/components/portal/PortalDealDocuments";

const useDocuments = vi.fn();
const getSigningUrl = vi.fn();
const refreshDocuSignStatus = vi.fn();
const getDownloadUrl = vi.fn();
vi.mock("@/hooks/useDocuments", () => ({
  useDocuments: (...a: unknown[]) => useDocuments(...a),
  getSigningUrl: (...a: unknown[]) => getSigningUrl(...a),
  refreshDocuSignStatus: (...a: unknown[]) => refreshDocuSignStatus(...a),
  getDownloadUrl: (...a: unknown[]) => getDownloadUrl(...a),
}));

const useAgentDocTemplatesForDeal = vi.fn();
vi.mock("@/hooks/useAgentDocs", () => ({
  DOC_TYPE_LABELS: {},
  useAgentDocTemplatesForDeal: (...a: unknown[]) =>
    useAgentDocTemplatesForDeal(...a),
}));

const refresh = vi.fn();

function doc(overrides: Record<string, unknown> = {}) {
  return {
    id: "d1",
    dealId: "deal-1",
    uploadedBy: "u",
    uploaderName: "Agent",
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

beforeEach(() => {
  vi.clearAllMocks();
  window.history.replaceState(null, "", "/buyer/u1");
  useAgentDocTemplatesForDeal.mockReturnValue({
    templates: [],
    loading: false,
    getDownloadUrl: vi.fn(),
  });
  useDocuments.mockReturnValue({ docs: [doc()], loading: false, refresh });
  getSigningUrl.mockResolvedValue("https://demo.docusign.net/signing/abc");
});

describe("PortalDealDocuments", () => {
  it("shows the envelope status badge", () => {
    render(<PortalDealDocuments dealId="deal-1" />);
    expect(screen.getByText("Awaiting signatures")).toBeInTheDocument();
  });

  it("Sign button redirects into the minted signing session", async () => {
    const assignSpy = vi
      .spyOn(window.location, "assign")
      .mockImplementation(() => {});
    const user = userEvent.setup();
    render(<PortalDealDocuments dealId="deal-1" />);

    await user.click(screen.getByRole("button", { name: /sign this document/i }));
    await waitFor(() =>
      expect(getSigningUrl).toHaveBeenCalledWith("deal-1", "d1")
    );
    expect(assignSpy).toHaveBeenCalledWith("https://demo.docusign.net/signing/abc");
  });

  it("hides the Sign button when the viewer is not a pending signer", () => {
    useDocuments.mockReturnValue({
      docs: [
        doc({ myRecipientStatus: null }),
        doc({ id: "d2", myRecipientStatus: "completed", docusignStatus: "completed" }),
      ],
      loading: false,
      refresh,
    });
    render(<PortalDealDocuments dealId="deal-1" />);
    expect(
      screen.queryByRole("button", { name: /sign this document/i })
    ).not.toBeInTheDocument();
  });

  it("surfaces the 409 hint when signing is email-based", async () => {
    getSigningUrl.mockRejectedValue(
      new Error("409 — this document was sent to your email")
    );
    const user = userEvent.setup();
    render(<PortalDealDocuments dealId="deal-1" />);
    await user.click(screen.getByRole("button", { name: /sign this document/i }));
    expect(await screen.findByText(/sent to your email/i)).toBeInTheDocument();
  });

  it("the signing_complete return refreshes status and shows the banner", async () => {
    refreshDocuSignStatus.mockResolvedValue({ status: "completed" });
    window.history.replaceState(
      null,
      "",
      "/buyer/u1?signed_doc=d1&event=signing_complete"
    );
    render(<PortalDealDocuments dealId="deal-1" />);

    expect(
      await screen.findByText(/signature recorded/i)
    ).toBeInTheDocument();
    await waitFor(() =>
      expect(refreshDocuSignStatus).toHaveBeenCalledWith("deal-1", "d1")
    );
    await waitFor(() => expect(refresh).toHaveBeenCalled());
    // Params stripped so a reload doesn't repeat the flow.
    expect(window.location.search).toBe("");
  });
});
