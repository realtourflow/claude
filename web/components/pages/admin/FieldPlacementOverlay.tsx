"use client";

import { useRef, useState, useCallback, useEffect } from "react";
import { CheckCircle2, MousePointer2, MoveVertical } from "lucide-react";
import type { AdminFormField } from "@/hooks/useAdminForms";
import { api } from "@/lib/api-client";

type PageSize = { page: number; width: number; height: number };
// Box position as fractions of the page, TOP-LEFT origin (what CSS wants).
type Frac = { x: number; y: number; w: number; h: number };

const clamp01 = (n: number) => Math.max(0, Math.min(1, n));
const LETTER = { width: 612, height: 792 };

/**
 * The MANDATORY placement review. Detected field boxes are drawn over each rendered
 * page (core = red, common = blue) and every box is draggable, so the admin verifies
 * a wrong-position-but-looks-done field by eye and nudges it onto its blank. A drag
 * saves the new position (which server-side clears any prior confirmation); the
 * Confirm button satisfies the gate that lets the form be approved.
 */
export function FieldPlacementOverlay({
  formId,
  fields,
  pages,
  confirmed,
  onSave,
  onConfirm,
  onNudgePage,
}: {
  formId: string;
  fields: AdminFormField[];
  pages: PageSize[];
  confirmed: boolean;
  onSave: (fieldId: string, pos: { pos_x: number; pos_y: number; width: number; height: number }) => Promise<void>;
  onConfirm: () => Promise<void>;
  onNudgePage: (page: number, dy: number) => Promise<void>;
}) {
  const pageById = new Map<number, PageSize>(pages.map((p) => [p.page, p]));
  const sizeOf = (page: number) => pageById.get(page) ?? { page, ...LETTER };

  // PDF rect (bottom-left) → top-left fraction.
  const toFrac = useCallback(
    (f: AdminFormField): Frac => {
      const pg = sizeOf(f.page_number);
      return {
        x: f.pos_x / pg.width,
        y: (pg.height - f.pos_y - f.height) / pg.height,
        w: f.width / pg.width,
        h: f.height / pg.height,
      };
    },
    // pageById is derived from props each render; recomputing toFrac is cheap.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [pages]
  );

  const [boxes, setBoxes] = useState<Record<string, Frac>>(() =>
    Object.fromEntries(fields.map((f) => [f.id, toFrac(f)]))
  );
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  // Per-page pending vertical nudge (points, +up). Slider previews it live; release
  // commits — saving the whole page in one shot, the fast fix for vision's
  // per-page offset.
  const [pageNudge, setPageNudge] = useState<Record<number, number>>({});
  const drag = useRef<{
    id: string;
    startX: number;
    startY: number;
    start: Frac;
    rect: DOMRect;
  } | null>(null);

  const pageNums = pages.length
    ? pages.map((p) => p.page)
    : [...new Set(fields.map((f) => f.page_number))].sort((a, b) => a - b);

  function onPointerDown(e: React.PointerEvent, f: AdminFormField, container: HTMLElement | null) {
    if (!container) return;
    e.preventDefault();
    drag.current = {
      id: f.id,
      startX: e.clientX,
      startY: e.clientY,
      start: boxes[f.id] ?? toFrac(f),
      rect: container.getBoundingClientRect(),
    };
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  }

  function onPointerMove(e: React.PointerEvent) {
    const d = drag.current;
    if (!d) return;
    const dx = (e.clientX - d.startX) / d.rect.width;
    const dy = (e.clientY - d.startY) / d.rect.height;
    setBoxes((b) => ({
      ...b,
      [d.id]: { ...d.start, x: clamp01(d.start.x + dx), y: clamp01(d.start.y + dy) },
    }));
  }

  async function onPointerUp(e: React.PointerEvent) {
    const d = drag.current;
    if (!d) return;
    drag.current = null;
    const f = fields.find((x) => x.id === d.id);
    if (!f) return;
    const dx = (e.clientX - d.startX) / d.rect.width;
    const dy = (e.clientY - d.startY) / d.rect.height;
    if (Math.abs(dx) < 0.0005 && Math.abs(dy) < 0.0005) return; // a click, not a drag
    const pg = sizeOf(f.page_number);
    const xFrac = clamp01(d.start.x + dx);
    const yFrac = clamp01(d.start.y + dy);
    const pos_x = Math.round(xFrac * pg.width);
    const pos_y = Math.round(pg.height - yFrac * pg.height - f.height); // back to bottom-left
    setDirty(true);
    setSaving(true);
    try {
      await onSave(f.id, { pos_x, pos_y, width: f.width, height: f.height });
    } finally {
      setSaving(false);
    }
  }

  async function handleConfirm() {
    setSaving(true);
    try {
      await onConfirm();
      setDirty(false);
    } finally {
      setSaving(false);
    }
  }

  // Release of the per-page slider: persist the shift (one save for the page), bake
  // it into the box positions, and reset the slider.
  async function commitNudge(page: number) {
    const dy = pageNudge[page] ?? 0;
    if (!dy) return;
    const pg = sizeOf(page);
    setSaving(true);
    try {
      await onNudgePage(page, dy);
      setBoxes((prev) => {
        const next = { ...prev };
        for (const f of fields) {
          if (f.page_number === page && next[f.id]) {
            next[f.id] = { ...next[f.id], y: clamp01(next[f.id].y - dy / pg.height) };
          }
        }
        return next;
      });
      setPageNudge((p) => ({ ...p, [page]: 0 }));
      setDirty(true);
    } finally {
      setSaving(false);
    }
  }

  const isConfirmed = confirmed && !dirty;
  const fieldsByPage = (page: number) => fields.filter((f) => f.page_number === page);

  return (
    <div className="space-y-4">
      {/* Sticky action bar — the gate. */}
      <div className="sticky top-0 z-20 flex items-center justify-between gap-3 rounded-lg border border-gray-200 bg-white/95 px-3 py-2 backdrop-blur">
        <div className="flex items-center gap-2 text-sm text-gray-500">
          <MousePointer2 size={15} className="text-gray-400" />
          Drag any box onto its blank. <span className="font-semibold text-red-600">Red</span> = core,{" "}
          <span className="font-semibold text-blue-600">blue</span> = common.
        </div>
        {isConfirmed ? (
          <span className="inline-flex items-center gap-1.5 rounded-lg bg-green-50 px-3 py-1.5 text-sm font-semibold text-green-700 border border-green-200">
            <CheckCircle2 size={15} /> Placement confirmed
          </span>
        ) : (
          <button
            type="button"
            onClick={handleConfirm}
            disabled={saving}
            className="inline-flex items-center gap-1.5 rounded-lg bg-brand-navy px-4 py-1.5 text-sm font-semibold text-white disabled:opacity-40"
          >
            <CheckCircle2 size={15} />
            {saving ? "Saving…" : "Confirm placement"}
          </button>
        )}
      </div>

      {pageNums.map((page) => {
        const pg = sizeOf(page);
        return (
          <PageCanvas
            key={page}
            formId={formId}
            page={page}
            aspect={pg.width / pg.height}
            pageHeight={pg.height}
            fields={fieldsByPage(page)}
            boxes={boxes}
            nudge={pageNudge[page] ?? 0}
            onNudge={(v) => setPageNudge((p) => ({ ...p, [page]: v }))}
            onNudgeCommit={() => commitNudge(page)}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
          />
        );
      })}
    </div>
  );
}

function PageCanvas({
  formId,
  page,
  aspect,
  pageHeight,
  fields,
  boxes,
  nudge,
  onNudge,
  onNudgeCommit,
  onPointerDown,
  onPointerMove,
  onPointerUp,
}: {
  formId: string;
  page: number;
  aspect: number;
  pageHeight: number;
  fields: AdminFormField[];
  boxes: Record<string, Frac>;
  nudge: number;
  onNudge: (v: number) => void;
  onNudgeCommit: () => void;
  onPointerDown: (e: React.PointerEvent, f: AdminFormField, container: HTMLElement | null) => void;
  onPointerMove: (e: React.PointerEvent) => void;
  onPointerUp: (e: React.PointerEvent) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  // Live nudge as a fraction of the page (subtract from each box's top).
  const nudgeFrac = nudge / pageHeight;
  return (
    <div className="overflow-hidden rounded-lg border border-gray-200">
      <div className="flex items-center justify-between gap-3 border-b border-gray-100 bg-gray-50 px-3 py-1.5">
        <span className="text-xs font-semibold text-gray-500">Page {page}</span>
        {/* Per-page nudge: shift every box on this page up/down in one save — the
            fast fix for vision's per-page vertical offset. */}
        <label className="flex items-center gap-1.5 text-xs text-gray-500">
          <MoveVertical size={13} className="text-gray-400" />
          Shift page
          <input
            type="range"
            min={-25}
            max={25}
            step={1}
            value={nudge}
            onChange={(e) => onNudge(Number(e.target.value))}
            onPointerUp={onNudgeCommit}
            onKeyUp={onNudgeCommit}
            className="w-28 accent-brand-navy"
            aria-label={`Shift all of page ${page} up or down`}
          />
          <span className="w-10 tabular-nums font-semibold text-brand-navy">
            {nudge > 0 ? `↑${nudge}` : nudge < 0 ? `↓${-nudge}` : "0"}
          </span>
        </label>
      </div>
      <div
        ref={ref}
        className="relative w-full select-none bg-white"
        style={{ aspectRatio: String(aspect) }}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
      >
        <PageImage formId={formId} page={page} />
        {fields.map((f) => {
          const b = boxes[f.id];
          if (!b) return null;
          const core = f.tier === "core";
          return (
            <div
              key={f.id}
              role="button"
              tabIndex={0}
              onPointerDown={(e) => onPointerDown(e, f, ref.current)}
              title={`${f.detected_name}${f.ai_core_key ? ` → ${f.ai_core_key}` : ""}`}
              className={`group absolute cursor-move touch-none rounded-[2px] border-2 ${
                core
                  ? "border-red-500/80 bg-red-400/15 hover:bg-red-400/30"
                  : "border-blue-500/80 bg-blue-400/15 hover:bg-blue-400/30"
              } hover:z-10`}
              style={{
                left: `${b.x * 100}%`,
                top: `${clamp01(b.y - nudgeFrac) * 100}%`,
                width: `${b.w * 100}%`,
                height: `${b.h * 100}%`,
                minWidth: 14,
                minHeight: 14,
              }}
            >
              <span
                className={`pointer-events-none absolute -top-4 left-0 hidden whitespace-nowrap rounded px-1 text-[10px] font-semibold text-white group-hover:block ${
                  core ? "bg-red-600" : "bg-blue-600"
                }`}
              >
                {f.detected_name}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/**
 * The rendered PDF page that backs the overlay. The route is admin-only (Bearer JWT),
 * which a plain <img src> can't satisfy — so fetch it through the authed api client
 * and show it via an object URL (revoked on unmount / page change).
 */
function PageImage({ formId, page }: { formId: string; page: number }) {
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let objectUrl: string | null = null;
    api
      .getBlob(`/admin/forms/${formId}/page-image?page=${page}`)
      .then((blob) => {
        if (cancelled) return;
        objectUrl = URL.createObjectURL(blob);
        setUrl(objectUrl);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [formId, page]);

  if (failed) {
    return (
      <div className="absolute inset-0 flex items-center justify-center bg-gray-50 text-xs text-gray-400">
        Couldn’t load page {page}
      </div>
    );
  }
  if (!url) {
    return (
      <div className="absolute inset-0 flex items-center justify-center bg-gray-50 text-xs text-gray-400">
        Loading page {page}…
      </div>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={url}
      alt={`Page ${page}`}
      className="absolute inset-0 h-full w-full object-contain"
      draggable={false}
    />
  );
}
