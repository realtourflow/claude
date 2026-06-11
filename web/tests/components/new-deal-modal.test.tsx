// @vitest-environment happy-dom
/**
 * Issue #106 — "Create Deal" modal stays stuck in "Creating…" state when the
 * API call fails. After the fix, the error message must appear and the submit
 * button must be re-enabled so the user can retry.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { NewDealModal } from "@/components/pages/agent/Pipeline";

vi.mock("@/lib/api-client", () => ({
  api: {
    get: vi.fn(),
    post: vi.fn(),
    patch: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
  },
  ApiError: class ApiError extends Error {
    status: number;
    body: unknown;
    constructor(status: number, statusText: string, body: unknown) {
      super(`${status} ${statusText}`);
      this.status = status;
      this.body = body;
    }
  },
  setTokenGetter: vi.fn(),
}));

// NewDealModal doesn't use routing, auth, or react-query — no providers needed.
import { api } from "@/lib/api-client";

const onClose = vi.fn();
const onCreated = vi.fn();

function fillAndSubmit() {
  fireEvent.change(screen.getByPlaceholderText(/e\.g\. jane doe/i), {
    target: { value: "Smith Family" },
  });
  fireEvent.change(screen.getByPlaceholderText("350,000"), {
    target: { value: "450000" },
  });
  fireEvent.submit(document.getElementById("new-deal-form")!);
}

describe("NewDealModal — API failure path (#106)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows an error message and re-enables the submit button when the API rejects", async () => {
    vi.mocked(api.post).mockRejectedValueOnce(new Error("Request timed out"));

    render(<NewDealModal onClose={onClose} onCreated={onCreated} />);

    fillAndSubmit();

    // While in-flight the button label changes and is disabled
    expect(screen.getByRole("button", { name: /creating/i })).toBeDisabled();

    // After the API call rejects: error message surfaces and button resets
    await waitFor(() => {
      expect(screen.getByText(/failed to create deal/i)).toBeInTheDocument();
    });
    expect(screen.getByRole("button", { name: /create deal/i })).not.toBeDisabled();
  });

  it("does not call onCreated when the API rejects", async () => {
    vi.mocked(api.post).mockRejectedValueOnce(new Error("Network error"));

    render(<NewDealModal onClose={onClose} onCreated={onCreated} />);

    fillAndSubmit();

    await waitFor(() => {
      expect(screen.getByText(/failed to create deal/i)).toBeInTheDocument();
    });

    expect(onCreated).not.toHaveBeenCalled();
  });
});
