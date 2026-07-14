// @vitest-environment happy-dom
/**
 * TC Documents section (#301).
 *
 * The TC dashboard Documents view used a module-level INIT_DOCS constant keyed
 * by literal fake deal ids ('deal-smith' / 'deal-williams'), so it showed the
 * same mock rows for those two ids and an empty box for every REAL deal — it
 * never rendered a real uploaded document. The Send Reminder / Mark OK / Request
 * buttons only mutated that local mock state (no API).
 *
 * These tests drive the real TCDashboard (section=documents) with useDeals and
 * useDocuments mocked at the module boundary, and assert the section now sources
 * each deal's REAL documents from useDocuments(deal.id) — the same hook the
 * agent Documents tab uses (TC read access landed in #235) — with statuses
 * derived from the real Document shape, and that the dead local-state buttons
 * are gone.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import TCDashboard from "@/components/pages/tc/TCDashboard";
import type { Deal } from "@/lib/types";
import type { Document } from "@/hooks/useDocuments";

const useDocumentsMock = vi.fn();
vi.mock("@/hooks/useDocuments", () => ({
  useDocuments: (...a: unknown[]) => useDocumentsMock(...a),
}));

let currentDeals: Deal[] = [];
vi.mock("@/hooks/useDeals", () => ({
  useDeals: () => ({ deals: currentDeals, loading: false, error: null, refresh: vi.fn() }),
}));

vi.mock("next/navigation", () => ({
  useParams: () => ({ section: "documents" }),
}));

function makeDeal(overrides: Partial<Deal> = {}): Deal {
  return {
    id: "deal-abc-123",
    clientName: "Jane Buyer",
    property: { address: "742 Evergreen Terrace" },
    ...overrides,
  } as unknown as Deal;
}

function makeDoc(overrides: Partial<Document> = {}): Document {
  return {
    id: "doc-1",
    dealId: "deal-abc-123",
    uploadedBy: "u1",
    uploaderName: "Agent Smith",
    name: "Purchase Agreement",
    s3Key: "key",
    mimeType: "application/pdf",
    fileSize: 1234,
    createdAt: "2026-02-01T00:00:00Z",
    docusignStatus: "completed",
    myRecipientStatus: null,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  currentDeals = [makeDeal()];
  useDocumentsMock.mockReturnValue({ docs: [], loading: false, error: null, refresh: vi.fn() });
});

describe("TC Documents — real data via useDocuments (#301)", () => {
  it("renders the deal's REAL documents (names + derived statuses) sourced from useDocuments(deal.id)", () => {
    useDocumentsMock.mockReturnValue({
      docs: [
        makeDoc({ id: "d1", name: "Purchase Agreement", docusignStatus: "completed" }),
        makeDoc({ id: "d2", name: "Seller Disclosures", docusignStatus: "sent" }),
        makeDoc({ id: "d3", name: "Inspection Report", docusignStatus: undefined }),
      ],
      loading: false,
      error: null,
      refresh: vi.fn(),
    });

    render(<TCDashboard />);

    // Sourced from the REAL deal id, not a hardcoded fake one.
    expect(useDocumentsMock).toHaveBeenCalledWith("deal-abc-123");

    // Real document names render.
    expect(screen.getByText("Purchase Agreement")).toBeInTheDocument();
    expect(screen.getByText("Seller Disclosures")).toBeInTheDocument();
    expect(screen.getByText("Inspection Report")).toBeInTheDocument();

    // Statuses derived from docusignStatus.
    expect(screen.getByText("Signed")).toBeInTheDocument(); // completed
    expect(screen.getByText("Awaiting signature")).toBeInTheDocument(); // sent
    expect(screen.getByText("Unsigned")).toBeInTheDocument(); // no envelope

    // signed/total summary derived from real docs (1 of 3 completed).
    expect(screen.getByText("1/3 signed")).toBeInTheDocument();
  });

  it("shows a genuine empty state (not the fake-id mock rows) when a real deal has zero documents", () => {
    useDocumentsMock.mockReturnValue({ docs: [], loading: false, error: null, refresh: vi.fn() });

    render(<TCDashboard />);

    expect(screen.getByText(/no documents/i)).toBeInTheDocument();
    // None of the old hardcoded mock document names may appear.
    expect(screen.queryByText("ARIVE Disclosures")).not.toBeInTheDocument();
    expect(screen.queryByText("Title Commitment")).not.toBeInTheDocument();
    expect(screen.queryByText("Settlement Statement")).not.toBeInTheDocument();
  });

  it("drops the dead Send Reminder / Mark OK / Request buttons and the fake-id mock rows", () => {
    // Even for the old fake id 'deal-smith', the section must now read REAL
    // documents from the hook and show none of the local-state mock controls.
    currentDeals = [makeDeal({ id: "deal-smith", clientName: "Smith Family" })];
    useDocumentsMock.mockReturnValue({
      docs: [makeDoc({ id: "w1", name: "Wire Instructions", docusignStatus: "completed" })],
      loading: false,
      error: null,
      refresh: vi.fn(),
    });

    render(<TCDashboard />);

    expect(useDocumentsMock).toHaveBeenCalledWith("deal-smith");
    // Real doc shows; the fake-id mock rows do not.
    expect(screen.getByText("Wire Instructions")).toBeInTheDocument();
    expect(screen.queryByText("ARIVE Disclosures")).not.toBeInTheDocument();
    expect(screen.queryByText("Proof of Funds")).not.toBeInTheDocument();

    // No dead local-mutation controls remain.
    expect(screen.queryByRole("button", { name: /send reminder/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /mark ok/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^request$/i })).not.toBeInTheDocument();
  });
});
