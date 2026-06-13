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
const getContractPrep = vi.fn();
const saveContractFacts = vi.fn();
const saveContractTerms = vi.fn();
vi.mock("@/hooks/useDocuments", () => ({
  listDocusignTemplates: (...args: unknown[]) => listDocusignTemplates(...args),
  sendTemplateForSignature: (...args: unknown[]) =>
    sendTemplateForSignature(...args),
  getContractPrep: (...args: unknown[]) => getContractPrep(...args),
  saveContractFacts: (...args: unknown[]) => saveContractFacts(...args),
  saveContractTerms: (...args: unknown[]) => saveContractTerms(...args),
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
    board: "",
    fieldMap: {},
  },
  {
    key: "listing_agreement",
    label: "Listing Agreement",
    roles: ["seller", "agent"],
    roleMapping: { seller: "Seller", agent: "Agent" },
    purpose: "",
    board: "",
    fieldMap: {},
  },
  {
    key: "birmingham_general_financed",
    label: "General/Financed Residential Contract",
    roles: ["buyer", "agent"],
    roleMapping: { buyer: "Buyer", agent: "Agent" },
    purpose: "",
    board: "BIRMINGHAM_AAR",
    fieldMap: {
      purchase_price: { label: "PurchasePrice", type: "text" },
      home_warranty: { label: "HomeWarranty", type: "checkbox" },
    },
  },
];

const PREP = {
  form: { key: "birmingham_general_financed", label: "General/Financed Residential Contract", board: "BIRMINGHAM_AAR" },
  core: [
    { key: "purchase_price", type: "number", value: "410000" },
    { key: "closing_date", type: "date", value: null },
  ],
  board_fields: [
    { key: "home_warranty", label: "HomeWarranty", type: "checkbox", value: null },
  ],
};

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
  getContractPrep.mockResolvedValue(PREP);
  saveContractFacts.mockResolvedValue(undefined);
  saveContractTerms.mockResolvedValue(undefined);
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
    expect(screen.getAllByText(/secure email link/i)).toHaveLength(2);

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

  it("a form with a fieldMap inserts the Prepare step and saves facts + terms", async () => {
    const user = userEvent.setup();
    renderModal();
    await user.click(
      await screen.findByText("General/Financed Residential Contract")
    );

    // Prepare step renders the merged fields prefilled from the deal.
    expect(await screen.findByText(/prepare contract/i)).toBeInTheDocument();
    const price = screen.getByLabelText(/purchase price/i);
    expect(price).toHaveValue(410000);

    await user.clear(price);
    await user.type(price, "425000");
    await user.click(screen.getByLabelText(/HomeWarranty/i));
    await user.click(screen.getByRole("button", { name: /save & continue/i }));

    await waitFor(() =>
      expect(saveContractFacts).toHaveBeenCalledWith(
        "deal-1",
        expect.objectContaining({ purchase_price: "425000" })
      )
    );
    expect(saveContractTerms).toHaveBeenCalledWith(
      "deal-1",
      "birmingham_general_financed",
      expect.objectContaining({ home_warranty: true })
    );

    // Then the signers step; Send fires the template send.
    expect(await screen.findByText("Mike Smith")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /^send$/i }));
    await waitFor(() =>
      expect(sendTemplateForSignature).toHaveBeenCalledWith(
        "deal-1",
        "birmingham_general_financed",
        []
      )
    );
  });

  it("a form without a fieldMap skips straight to signers", async () => {
    const user = userEvent.setup();
    renderModal();
    await user.click(await screen.findByText("Buyer Agency Agreement"));
    expect(screen.queryByText(/prepare contract/i)).not.toBeInTheDocument();
    expect(screen.getByText("Mike Smith")).toBeInTheDocument();
  });
});