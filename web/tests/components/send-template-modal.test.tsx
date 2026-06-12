// @vitest-environment happy-dom
/**
 * SendTemplateModal — the PRIMARY send-for-signature flow. Agent picks a
 * configured form; roles auto-fill from the deal's participants (with the
 * agent previewed from the active user); roles nobody on the deal can fill
 * collect an outside signer's email/name (hybrid — they get a DocuSign email).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import SendTemplateModal from "@/components/pages/agent/SendTemplateModal";

const listDocusignTemplates = vi.fn();
const sendTemplateForSignature = vi.fn();
vi.mock("@/hooks/useDocuments", () => ({
  listDocusignTemplates: (...args: unknown[]) => listDocusignTemplates(...args),
  sendTemplateForSignature: (...args: unknown[]) =>
    sendTemplateForSignature(...args),
}));

const useParticipants = vi.fn();
vi.mock("@/hooks/useParticipants", () => ({
  useParticipants: (...args: unknown[]) => useParticipants(...args),
}));

const TEMPLATES = [
  {
    key: "buyer_agency_agreement",
    label: "Buyer Agency Agreement",
    roles: ["buyer", "agent"],
    roleMapping: { buyer: "Buyer", agent: "Agent" },
    purpose: "baa",
  },
  {
    key: "listing_agreement",
    label: "Listing Agreement",
    roles: ["seller", "agent"],
    roleMapping: { seller: "Seller", agent: "Agent" },
    purpose: "",
  },
];

const AGENT = { id: "u-agent", name: "Sarah Johnson", email: "sarah@example.com" };
const BUYER = {
  id: "u-buyer",
  name: "Mike Smith",
  email: "mike@example.com",
  role: "buyer",
};

beforeEach(() => {
  vi.clearAllMocks();
  listDocusignTemplates.mockResolvedValue(TEMPLATES);
  useParticipants.mockReturnValue({ participants: [BUYER] });
  sendTemplateForSignature.mockResolvedValue({
    envelope_id: "env-tpl-1",
    status: "sent",
    document: { id: "doc-1" },
  });
});

function renderModal(onSent = vi.fn()) {
  return render(
    <SendTemplateModal
      dealId="deal-1"
      agent={AGENT}
      onClose={vi.fn()}
      onSent={onSent}
    />
  );
}

describe("SendTemplateModal", () => {
  it("lists the configured forms", async () => {
    renderModal();
    expect(await screen.findByText("Buyer Agency Agreement")).toBeInTheDocument();
    expect(screen.getByText("Listing Agreement")).toBeInTheDocument();
  });

  it("auto-fills roles from participants + agent and sends with no overrides", async () => {
    const user = userEvent.setup();
    const onSent = vi.fn();
    renderModal(onSent);

    await user.click(await screen.findByText("Buyer Agency Agreement"));
    // Both roles matched: buyer participant + the agent, labeled for in-app signing.
    expect(screen.getByText("Mike Smith")).toBeInTheDocument();
    expect(screen.getByText("Sarah Johnson")).toBeInTheDocument();
    expect(screen.getAllByText(/signs in-app/i)).toHaveLength(2);

    await user.click(screen.getByRole("button", { name: /^send$/i }));
    await waitFor(() =>
      expect(sendTemplateForSignature).toHaveBeenCalledWith(
        "deal-1",
        "buyer_agency_agreement",
        []
      )
    );
    await waitFor(() => expect(onSent).toHaveBeenCalled());
  });

  it("collects an outside signer for an unfilled role and sends the override", async () => {
    const user = userEvent.setup();
    renderModal();

    // The deal has no seller — the Seller role needs an outside signer.
    await user.click(await screen.findByText("Listing Agreement"));
    expect(screen.getByText(/no seller on this deal/i)).toBeInTheDocument();

    await user.type(screen.getByPlaceholderText(/signer name/i), "Out Sider");
    await user.type(
      screen.getByPlaceholderText(/signer email/i),
      "out@example.com"
    );
    expect(screen.getByText(/docusign email/i)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /^send$/i }));
    await waitFor(() =>
      expect(sendTemplateForSignature).toHaveBeenCalledWith(
        "deal-1",
        "listing_agreement",
        [{ role_name: "Seller", email: "out@example.com", name: "Out Sider" }]
      )
    );
  });

  it("disables Send until every unfilled role has an outside signer", async () => {
    const user = userEvent.setup();
    renderModal();
    await user.click(await screen.findByText("Listing Agreement"));
    expect(screen.getByRole("button", { name: /^send$/i })).toBeDisabled();
  });

  it("surfaces a send failure", async () => {
    sendTemplateForSignature.mockRejectedValue(new Error("DocuSign down"));
    const user = userEvent.setup();
    renderModal();
    await user.click(await screen.findByText("Buyer Agency Agreement"));
    await user.click(screen.getByRole("button", { name: /^send$/i }));
    expect(await screen.findByText(/DocuSign down/)).toBeInTheDocument();
  });

  it("shows the empty state when no forms are configured", async () => {
    listDocusignTemplates.mockResolvedValue([]);
    renderModal();
    expect(
      await screen.findByText(/no standard forms configured/i)
    ).toBeInTheDocument();
  });
});
