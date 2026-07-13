// @vitest-environment happy-dom
/**
 * DealDetail component tests.
 *
 * 1) UploadDocModal — regression tests for issue #190: the blob PUT response
 *    must be checked BEFORE confirmUpload. A failed PUT (413/500) must surface
 *    an error and must NOT create the documents row (phantom document) or show
 *    the green "Document uploaded" success screen. Only a 2xx PUT may confirm.
 *
 * 2) Stage advance (#185) — the modal drafts a client message and promises it
 *    is "Sent to client's portal". Confirming the advance must actually POST
 *    the (edited) draft to the deal's client_thread, an empty draft must post
 *    nothing, a failed post must never break the advance itself, and the
 *    modal must not claim automations that don't exist ("TC alerted to open
 *    file", "Commission paperwork queued").
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import DealDetail, { UploadDocModal, StageAdvanceModal } from "@/components/pages/agent/DealDetail";
import type { Deal } from "@/lib/data/mockDeals";

const requestUploadUrl = vi.fn();
const confirmUpload = vi.fn();
// #189 — the direct-to-Blob byte path. Mocked at the SDK boundary so the real
// lib/direct-upload logic (direct → proxy fallback, size-error mapping) runs.
const uploadPresignedMock = vi.fn();
vi.mock("@vercel/blob/client", () => ({
  uploadPresigned: (...a: unknown[]) => uploadPresignedMock(...a),
}));
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

// ─── Full-page harness mocks (stage-advance flow, #185) ─────────────────────
// DealDetail is rendered whole, so every hook/store it (or an always-rendered
// child) calls is mocked at the module boundary — the same seam pattern the
// other component tests use. Spies are dereferenced lazily (`(...a) => spy(...a)`)
// so vi.mock hoisting stays safe.

const DEAL_ID = "5f0f6f6a-9b1c-4f6e-8a2d-3c4b5a697e01";

function makeDeal(overrides: Partial<Deal> = {}): Deal {
  return {
    id: DEAL_ID,
    type: "buy",
    clientName: "Jane Buyer",
    clientId: "",
    agentId: "agent-1",
    stage: "active_search",
    health: "green",
    priority: "medium",
    property: {
      address: "123 Main Street",
      city: "Birmingham",
      state: "AL",
      zip: "35203",
      price: 350000,
    },
    timeline: {
      createdAt: "2026-05-01T00:00:00Z",
      daysInStage: 4,
    },
    flags: [],
    status: "active",
    estimatedCommission: 10500,
    openTaskCount: 0,
    overdueTaskCount: 0,
    ...overrides,
  };
}

let currentDeal: Deal;

const patchStage = vi.fn();
vi.mock("@/hooks/useDeals", () => ({
  useDeal: () => ({ deal: currentDeal, loading: false, error: null, refresh: vi.fn() }),
  patchStage: (...a: unknown[]) => patchStage(...a),
}));

const postMessage = vi.fn();
vi.mock("@/hooks/useMessages", () => ({
  useMessages: () => ({ messages: [], loading: false, error: null, refresh: vi.fn() }),
  postMessage: (...a: unknown[]) => postMessage(...a),
}));

const postTask = vi.fn();
vi.mock("@/hooks/useTasks", () => ({
  useTasks: () => ({ tasks: [], loading: false, refresh: vi.fn() }),
  postTask: (...a: unknown[]) => postTask(...a),
  patchTask: vi.fn(),
  patchTaskStatus: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useParams: () => ({ dealId: DEAL_ID }),
  useRouter: () => ({ back: vi.fn(), push: vi.fn(), replace: vi.fn() }),
  // Land on the light Timeline tab — Overview drags in many more cards.
  useSearchParams: () => new URLSearchParams("tab=timeline"),
}));

const setStage = vi.fn();
vi.mock("@/lib/store/dealStageStore", () => ({
  useDealStageStore: () => ({ stageByDeal: {}, setStage: (...a: unknown[]) => setStage(...a) }),
}));

vi.mock("@/lib/store/authStore", () => ({
  useAuthStore: (sel?: (s: unknown) => unknown) => {
    const state = { activeUser: { id: "agent-1", groupId: "agent", name: "Agent Amy" } };
    return sel ? sel(state) : state;
  },
}));

const addClientNotification = vi.fn();
vi.mock("@/lib/store/notificationStore", () => ({
  useNotificationStore: (sel?: (s: unknown) => unknown) => {
    const state = { addClientNotification: (...a: unknown[]) => addClientNotification(...a) };
    return sel ? sel(state) : state;
  },
}));

vi.mock("@/lib/store/taskStore", () => ({
  useTaskStore: () => ({ reassign: vi.fn(), effectiveAssignee: () => undefined }),
}));

vi.mock("@/permissions/usePermission", () => ({
  usePermission: () => ({
    can: () => true,
    canAny: () => true,
    canAll: () => true,
    currentGroup: "agent",
    hasPermission: () => true,
  }),
}));

vi.mock("@/lib/api-client", () => ({
  api: {
    get: vi.fn(async () => []),
    post: vi.fn(async () => ({})),
    patch: vi.fn(async () => ({})),
    delete: vi.fn(async () => ({})),
  },
  ApiError: class ApiError extends Error {
    status: number;
    body?: { gate?: string; blocking_tasks?: { id: string; title: string }[] };
    constructor(status: number, message: string) {
      super(message);
      this.status = status;
    }
  },
  setTokenGetter: vi.fn(),
}));

// Hooks/components pulled in by tabs and cards these tests never exercise.
vi.mock("@/hooks/useParticipants", () => ({
  useParticipants: () => ({ participants: [], loading: false, refresh: vi.fn() }),
}));
vi.mock("@/hooks/useVendors", () => ({
  useVendors: () => ({ vendors: [], loading: false, refresh: vi.fn() }),
}));
vi.mock("@/hooks/useProperties", () => ({
  useProperties: () => ({ properties: [], loading: false, refresh: vi.fn() }),
}));
vi.mock("@/hooks/useShowingAvailability", () => ({
  useShowingAvailability: () => ({ slots: [], loading: false, refresh: vi.fn() }),
  DAYS_OF_WEEK: [],
}));
vi.mock("@/hooks/useOffers", () => ({
  useOffers: () => ({ offers: [], loading: false, refresh: vi.fn() }),
}));
vi.mock("@/hooks/useNetSheet", () => ({
  useNetSheet: () => ({ lines: [], loading: false, refresh: vi.fn() }),
  recalcLines: () => [],
  calcNetProceeds: () => 0,
}));
vi.mock("@/hooks/useContingencies", () => ({
  useContingencies: () => ({ contingencies: [], loading: false, refresh: vi.fn() }),
}));
vi.mock("@/components/MetroMap", () => ({ default: () => null }));
vi.mock("@/components/DealInviteModal", () => ({ default: () => null }));
vi.mock("@/components/pages/agent/SendTemplateModal", () => ({ default: () => null }));
vi.mock("@/components/net-sheet/AddCustomLineControl", () => ({
  AddCustomLineControl: () => null,
}));
vi.mock("@/components/contingencies/AddContingencyForm", () => ({
  AddContingencyForm: () => null,
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

// ─── Direct-to-Blob upload (#189) ────────────────────────────────────────────
// Vercel Functions reject bodies over ~4.5MB at the edge, so files 4.5–25MB
// could never reach the blob-put proxy in prod. When the server hands back a
// client_upload_url, the modal must push the bytes directly to Blob via the
// SDK's presigned flow — no function in the byte path — while preserving the
// #190 invariant: a failed upload NEVER confirms a documents row.

describe("UploadDocModal direct-to-blob upload (#189)", () => {
  const CLIENT_UPLOAD_URL = "/api/storage/client-upload?key=k&exp=1&sig=s";

  beforeEach(() => {
    requestUploadUrl.mockResolvedValue({
      upload_url: UPLOAD_URL,
      client_upload_url: CLIENT_UPLOAD_URL,
      s3_key: S3_KEY,
    });
  });

  it("uploads directly to Blob (no proxy fetch in the byte path) and confirms", async () => {
    uploadPresignedMock.mockResolvedValue({ pathname: S3_KEY });
    const { onUploaded } = await submitUpload();

    expect(await screen.findByText(/document uploaded/i)).toBeInTheDocument();
    // The SDK presigned upload carried the file, pinned to the server's key.
    expect(uploadPresignedMock).toHaveBeenCalledWith(
      S3_KEY,
      FILE,
      expect.objectContaining({
        access: "private",
        handleUploadUrl: CLIENT_UPLOAD_URL,
        contentType: "application/pdf",
      })
    );
    // The file body never went through the app's own fetch (the ~4.5MB proxy).
    expect(fetchMock).not.toHaveBeenCalled();
    await waitFor(() =>
      expect(confirmUpload).toHaveBeenCalledWith(
        "deal-1",
        "Buyer Agency Agreement",
        S3_KEY,
        "application/pdf",
        FILE.size
      )
    );
    expect(onUploaded).toHaveBeenCalled();
  });

  it("a too-large direct upload shows the 25MB error, never confirms, never falls back", async () => {
    uploadPresignedMock.mockRejectedValue(
      new Error("Vercel Blob: the file length cannot be greater than 26214400")
    );
    const { onUploaded } = await submitUpload();

    expect(await screen.findByText(/file too large \(max 25MB\)/i)).toBeInTheDocument();
    expect(confirmUpload).not.toHaveBeenCalled();
    expect(onUploaded).not.toHaveBeenCalled();
    // A size rejection must not retry through the proxy (it would 413 anyway).
    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.queryByText(/document uploaded/i)).not.toBeInTheDocument();
  });

  it("a non-size direct failure falls back to the proxy; a failed fallback never confirms", async () => {
    uploadPresignedMock.mockRejectedValue(new Error("network down"));
    fetchMock.mockResolvedValue({ ok: false, status: 500 });
    const { onUploaded } = await submitUpload();

    expect(await screen.findByText(/upload failed\. please try again\./i)).toBeInTheDocument();
    // The direct path was attempted first…
    expect(uploadPresignedMock).toHaveBeenCalled();
    // …then the fallback attempted the capability-URL proxy…
    expect(fetchMock).toHaveBeenCalledWith(
      UPLOAD_URL,
      expect.objectContaining({ method: "PUT", body: FILE })
    );
    // …and the failed upload still never created a documents row.
    expect(confirmUpload).not.toHaveBeenCalled();
    expect(onUploaded).not.toHaveBeenCalled();
  });

  it("a successful proxy fallback still confirms the upload", async () => {
    uploadPresignedMock.mockRejectedValue(new Error("blob api hiccup"));
    fetchMock.mockResolvedValue({ ok: true, status: 200 });
    const { onUploaded } = await submitUpload();

    expect(await screen.findByText(/document uploaded/i)).toBeInTheDocument();
    expect(uploadPresignedMock).toHaveBeenCalled();
    await waitFor(() => expect(confirmUpload).toHaveBeenCalled());
    expect(onUploaded).toHaveBeenCalled();
  });
});

// ─── Stage advance — drafted client message must actually send (#185) ────────

describe("Stage advance posts the drafted client message (#185)", () => {
  beforeEach(() => {
    currentDeal = makeDeal(); // active_search → next stage is offer_active
    patchStage.mockResolvedValue(undefined);
    postTask.mockResolvedValue(undefined);
    postMessage.mockResolvedValue({ id: "msg-1" });
  });

  /** Render the page, click the advance button, wait for the modal. */
  async function openAdvanceModal() {
    const user = userEvent.setup();
    render(<DealDetail />);
    // The advance button is labeled with the next stage's name.
    await user.click(screen.getByRole("button", { name: /offer active/i }));
    await screen.findByRole("button", { name: /confirm & advance/i });
    return user;
  }

  it("posts the edited draft to the client thread on confirm", async () => {
    const user = await openAdvanceModal();

    // Edit the drafted message, exactly like the repro in the ticket.
    await user.click(screen.getByRole("button", { name: /edit/i }));
    const textarea = screen.getByRole("textbox");
    await user.clear(textarea);
    await user.type(textarea, "Custom note for my client");

    await user.click(screen.getByRole("button", { name: /confirm & advance/i }));

    await waitFor(() =>
      expect(postMessage).toHaveBeenCalledWith(
        DEAL_ID,
        "client_thread",
        "Custom note for my client"
      )
    );
    // The stage advance itself is unchanged.
    expect(patchStage).toHaveBeenCalledWith(DEAL_ID, "offer_active", undefined);
    expect(setStage).toHaveBeenCalledWith(DEAL_ID, "offer_active");
  });

  it("posts the default draft as-is when the agent doesn't edit it", async () => {
    const user = await openAdvanceModal();
    await user.click(screen.getByRole("button", { name: /confirm & advance/i }));

    await waitFor(() => expect(postMessage).toHaveBeenCalledTimes(1));
    const [dealId, channel, body] = postMessage.mock.calls[0];
    expect(dealId).toBe(DEAL_ID);
    expect(channel).toBe("client_thread");
    // The offer_active draft is personalized with client + address.
    expect(body).toMatch(/Jane/);
    expect(body).toMatch(/123 Main Street/);
  });

  it("an empty draft posts nothing (stage still advances)", async () => {
    const user = await openAdvanceModal();

    await user.click(screen.getByRole("button", { name: /edit/i }));
    await user.clear(screen.getByRole("textbox"));
    await user.click(screen.getByRole("button", { name: /confirm & advance/i }));

    await waitFor(() =>
      expect(patchStage).toHaveBeenCalledWith(DEAL_ID, "offer_active", undefined)
    );
    // Wait for the flow to finish (modal closes) before asserting no post.
    await waitFor(() =>
      expect(
        screen.queryByRole("button", { name: /confirm & advance/i })
      ).not.toBeInTheDocument()
    );
    expect(postMessage).not.toHaveBeenCalled();
  });

  it("a failed message send never breaks the advance and surfaces a warning", async () => {
    postMessage.mockRejectedValue(new Error("network down"));
    const user = await openAdvanceModal();

    await user.click(screen.getByRole("button", { name: /confirm & advance/i }));

    // The advance completed…
    await waitFor(() => expect(setStage).toHaveBeenCalledWith(DEAL_ID, "offer_active"));
    await waitFor(() =>
      expect(
        screen.queryByRole("button", { name: /confirm & advance/i })
      ).not.toBeInTheDocument()
    );
    // …and the failure is surfaced without blocking anything.
    expect(
      await screen.findByText(/client message could not be sent/i)
    ).toBeInTheDocument();
  });
});

// ─── Stage-advance modal — no fictional automation claims (#185) ─────────────

describe("StageAdvanceModal automation claims match reality (#185)", () => {
  const noop = () => {};

  it("under_contract: no 'TC alerted to open file' claim", () => {
    render(
      <StageAdvanceModal
        deal={makeDeal({ stage: "offer_active" })}
        nextStage="under_contract"
        gateError={null}
        onConfirm={noop}
        onCancel={noop}
      />
    );
    expect(screen.queryByText(/tc alerted/i)).not.toBeInTheDocument();
    // The honest items stay: auto tasks + the (now real) client message send.
    expect(screen.getByText(/tasks auto-generated/i)).toBeInTheDocument();
    expect(screen.getByText(/client message sent to jane buyer/i)).toBeInTheDocument();
  });

  it("post_close: no 'Commission paperwork queued' claim", () => {
    render(
      <StageAdvanceModal
        deal={makeDeal({ stage: "closing" })}
        nextStage="post_close"
        gateError={null}
        onConfirm={noop}
        onCancel={noop}
      />
    );
    expect(screen.queryByText(/commission paperwork queued/i)).not.toBeInTheDocument();
  });

  it("pre_close keeps the real calendar-sync claim", () => {
    render(
      <StageAdvanceModal
        deal={makeDeal({ stage: "under_contract" })}
        nextStage="pre_close"
        gateError={null}
        onConfirm={noop}
        onCancel={noop}
      />
    );
    expect(screen.getByText(/closing date synced to calendar/i)).toBeInTheDocument();
  });

  it("clearing the draft removes the 'client message sent' claim", async () => {
    const user = userEvent.setup();
    render(
      <StageAdvanceModal
        deal={makeDeal()}
        nextStage="offer_active"
        gateError={null}
        onConfirm={noop}
        onCancel={noop}
      />
    );
    expect(screen.getByText(/client message sent to jane buyer/i)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /edit/i }));
    await user.clear(screen.getByRole("textbox"));

    expect(screen.queryByText(/client message sent/i)).not.toBeInTheDocument();
  });
});
