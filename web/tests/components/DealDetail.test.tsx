// @vitest-environment happy-dom
/**
 * UploadDocModal (DealDetail) — the agent's document-upload flow.
 *
 * Regression tests for issue #190: the blob PUT response must be checked
 * BEFORE confirmUpload. A failed PUT (413/500) must surface an error and
 * must NOT create the documents row (phantom document) or show the green
 * "Document uploaded" success screen. Only a 2xx PUT may confirm.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { UploadDocModal } from "@/components/pages/agent/DealDetail";

const requestUploadUrl = vi.fn();
const confirmUpload = vi.fn();
vi.mock("@/hooks/useDocuments", () => ({
  useDocuments: vi.fn(() => ({
    docs: [],
    loading: false,
    error: null,
    refresh: vi.fn(),
  })),
  requestUploadUrl: (...a: unknown[]) => requestUploadUrl(...a),
  confirmUpload: (...a: unknown[]) => confirmUpload(...a),
  getDownloadUrl: vi.fn(),
  deleteDocument: vi.fn(),
  sendForSignatureByUserIds: vi.fn(),
  refreshDocuSignStatus: vi.fn(),
  setDisclosuresComplete: vi.fn(),
}));

// The modal PUTs the file to the capability URL with the global fetch —
// stub it so we control the blob-put response (ok / 413 / 500).
const fetchMock = vi.fn();

const UPLOAD_URL = "https://app.example.com/api/storage/blob-put?key=k&sig=s";
const S3_KEY = "deals/deal-1/contract.pdf";

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("fetch", fetchMock);
  requestUploadUrl.mockResolvedValue({ upload_url: UPLOAD_URL, s3_key: S3_KEY });
  confirmUpload.mockResolvedValue({ id: "doc-1" });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const FILE = new File(["dummy pdf bytes"], "contract.pdf", {
  type: "application/pdf",
});

/** Render the modal, pick a file, and click Upload. */
async function submitUpload() {
  const user = userEvent.setup();
  const onUploaded = vi.fn();
  const onClose = vi.fn();
  render(<UploadDocModal dealId="deal-1" onClose={onClose} onUploaded={onUploaded} />);

  await user.upload(screen.getByLabelText(/browse/i), FILE);
  await user.click(screen.getByRole("button", { name: /^upload$/i }));
  return { user, onUploaded, onClose };
}

describe("UploadDocModal PUT response handling (#190)", () => {
  it("a failed PUT (413) does NOT confirm the document and shows an error", async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 413 });
    const { onUploaded } = await submitUpload();

    // An error surfaces…
    expect(await screen.findByText(/file too large/i)).toBeInTheDocument();
    // …no phantom documents row is created, no success screen, no refresh.
    expect(confirmUpload).not.toHaveBeenCalled();
    expect(onUploaded).not.toHaveBeenCalled();
    expect(screen.queryByText(/document uploaded/i)).not.toBeInTheDocument();
  });

  it("a 413 surfaces the size-limit message (max 25MB)", async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 413 });
    await submitUpload();

    expect(
      await screen.findByText(/file too large \(max 25MB\)/i)
    ).toBeInTheDocument();
  });

  it("a failed PUT (500) does NOT confirm and shows the generic error", async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 500 });
    const { onUploaded } = await submitUpload();

    expect(
      await screen.findByText(/upload failed\. please try again\./i)
    ).toBeInTheDocument();
    expect(confirmUpload).not.toHaveBeenCalled();
    expect(onUploaded).not.toHaveBeenCalled();
    expect(screen.queryByText(/document uploaded/i)).not.toBeInTheDocument();
  });

  it("a successful PUT confirms the upload and shows the success screen", async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200 });
    const { onUploaded } = await submitUpload();

    expect(await screen.findByText(/document uploaded/i)).toBeInTheDocument();

    // The PUT went to the capability URL with the file body…
    expect(fetchMock).toHaveBeenCalledWith(
      UPLOAD_URL,
      expect.objectContaining({ method: "PUT", body: FILE })
    );
    // …and only then was the documents row confirmed.
    await waitFor(() =>
      expect(confirmUpload).toHaveBeenCalledWith(
        "deal-1",
        "Buyer Agency Agreement", // the default document-type option
        S3_KEY,
        "application/pdf",
        FILE.size
      )
    );
    expect(onUploaded).toHaveBeenCalled();
  });

  it("keeps the form usable after a failed PUT (can retry)", async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 500 });
    await submitUpload();
    await screen.findByText(/upload failed/i);

    // The Upload button is re-enabled — the agent can retry.
    expect(screen.getByRole("button", { name: /^upload$/i })).toBeEnabled();
  });
});
