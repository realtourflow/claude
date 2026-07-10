// @vitest-environment happy-dom
/**
 * MyFormsSection — Settings → My Forms list (issue #194).
 *
 * After an admin splits a bundle, the parent row keeps status "split" and
 * GET /api/me/forms returns it unfiltered. StatusChip indexed STATUS_STYLES
 * with no fallback, so one "split" (or any unknown/future) status threw a
 * TypeError and crashed the whole section. These tests pin the fix: every
 * status renders a labeled chip — known ones with their style, unknown ones
 * with a safe fallback.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { MyFormsSection } from "@/components/pages/settings/MyFormsSection";
import type { UploadedForm } from "@/hooks/useAgentForms";

const useAgentForms = vi.fn();
vi.mock("@/hooks/useAgentForms", () => ({
  useAgentForms: (...args: unknown[]) => useAgentForms(...args),
}));

// FormUploader has its own hook/data needs — stub it out; it's not under test.
vi.mock("@/components/FormUploader", () => ({
  default: () => <div data-testid="form-uploader" />,
}));

function form(overrides: Partial<UploadedForm> = {}): UploadedForm {
  return {
    id: "f-1",
    label: "Purchase Agreement",
    side: "buy",
    status: "ready",
    fileName: "pa.pdf",
    fieldCount: 12,
    needsReviewCount: 0,
    createdAt: "2026-07-01T00:00:00.000Z",
    ...overrides,
  };
}

function mockForms(forms: UploadedForm[], loading = false) {
  useAgentForms.mockReturnValue({ forms, loading });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("MyFormsSection status chips", () => {
  it("renders a split-bundle parent row without crashing (issue #194)", () => {
    mockForms([
      form({ id: "f-bundle", label: "All Buyer Docs", status: "split" }),
      form({ id: "f-ok", label: "Listing Agreement", status: "ready" }),
    ]);

    render(<MyFormsSection />);

    // The whole section must survive the split row…
    expect(screen.getByText("All Buyer Docs")).toBeInTheDocument();
    expect(screen.getByText("Listing Agreement")).toBeInTheDocument();
    // …and the split parent gets a real label, not a crash.
    expect(screen.getByText("Split into separate forms")).toBeInTheDocument();
  });

  it("renders a safe fallback chip for an unknown/future status", () => {
    mockForms([
      form({
        id: "f-future",
        label: "Mystery Form",
        // A status this build has never heard of.
        status: "hologram_review" as UploadedForm["status"],
      }),
    ]);

    render(<MyFormsSection />);

    expect(screen.getByText("Mystery Form")).toBeInTheDocument();
    // Fallback humanizes the raw status instead of throwing.
    expect(screen.getByText("hologram review")).toBeInTheDocument();
  });

  it("renders every known status with its existing label", () => {
    mockForms([
      form({ id: "f-1", label: "A", status: "detecting" }),
      form({ id: "f-2", label: "B", status: "pending_review" }),
      form({ id: "f-3", label: "C", status: "pending_split" }),
      form({ id: "f-4", label: "D", status: "ready" }),
      form({ id: "f-5", label: "E", status: "rejected" }),
      form({ id: "f-6", label: "F", status: "archived" }),
    ]);

    render(<MyFormsSection />);

    expect(screen.getByText("Detecting fields…")).toBeInTheDocument();
    expect(screen.getByText("Pending review")).toBeInTheDocument();
    expect(screen.getByText("Awaiting split")).toBeInTheDocument();
    expect(screen.getByText("Ready")).toBeInTheDocument();
    expect(screen.getByText("Rejected")).toBeInTheDocument();
    expect(screen.getByText("Archived")).toBeInTheDocument();
  });
});
