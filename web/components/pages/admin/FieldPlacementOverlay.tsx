"use client";

import { useRef, useState, useCallback, useEffect } from "react";
import { CheckCircle2, MousePointer2, MoveVertical, Plus, Trash2, X } from "lucide-react";
import type { AdminFormField, TypeFieldOption, NewField } from "@/hooks/useAdminForms";
import { api } from "@/lib/api-client";

type PageSize = { page: number; width: number; height: number };
// Box position as fractions of the page, TOP-LEFT origin (what CSS wants).
type Frac = { x: number; y: number; w: number; h: number };

const clamp01 = (n: number) => Math.max(0, Math.min(1, n));
const LETTER = { width: 612, height: 792 };

// Default box size (PDF points) for a newly added field, by type — a sensible
// starting rectangle the admin then drags onto the actual blank.
const DEFAULT_SIZE: Record<string, { w: number; h: number }> = {
  text: { w: 170, h: 16 },
  date: { w: 90, h: 16 },
  initial: { w: 48, h: 18 },
  signature: { w: 200, h: 24 },
  checkbox: { w: 14, h: 14 },
};
const sizeForType = (t: string) => DEFAULT_SIZE[t] ?? DEFAULT_SIZE.text;
const FIELD_TYPES = ["text", "checkbox", "signature", "initial", "date"];

/**
 * The MANDATORY placement review. Detected field boxes are drawn over each rendered
 * page (core = red, common = blue) and every box is draggable, so the admin verifies
 * a wrong-position-but-looks-done field by eye and nudges it onto its blank. When
 * vision MISSES a field entirely, the admin adds it from the document type's master
 * list (or a custom one) and places it; a box on the wrong thing can be deleted. Any
 * add/move/delete clears the placement confirmation server-side; the Confirm button
 * satisfies the gate that lets the form be approved.
 */
export function FieldPlacementOverlay({
  formId,
  fields,
  pages,
  typeFields,
  confirmed,
  onSave,
  onConfirm,
  onNudgePage,
  onAddField,
  onDeleteField,
}: {
  formId: string;
  fields: AdminFormField[];
  pages: PageSize[];
  typeFields: TypeFieldOption[];
  confirmed: boolean;
  onSave: (fieldId: string, pos: { pos_x: number; pos_y: number; width: number; height: number }) => Promise<void>;
  onConfirm: () => Promise<void>;
  onNudgePage: (page: number, dy: number) => Promise<void>;
  onAddField: (field: NewField) => Promise<{ id: string; page_number: number }>;
  onDeleteField: (fieldId: string) => Promise<void>;
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

  // Live drag positions, keyed by field id. A field NOT in here (just added, not yet
  // dragged) falls back to its server position via toFrac — so adds show instantly
  // and deletes drop out (the field leaves `fields`) without a sync effect.
  const [boxes, setBoxes] = useState<Record<string, Frac>>(() =>
    Object.fromEntries(fields.map((f) => [f.id, toFrac(f)]))
  );
  const fracOf = (f: AdminFormField): Frac => boxes[f.id] ?? toFrac(f);

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

  // --- Add-a-missing-field drawer state ---
  const [adding, setAdding] = useState(false);
  const [addPage, setAddPage] = useState(1);
  const [search, setSearch] = useState("");
  const [customLabel, setCustomLabel] = useState("");
  const [customType, setCustomType] = useState("text");
  const [addBusy, setAddBusy] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);
  // The just-added field — flashed + scrolled into view so an add is never "did it
  // even work?". Cleared after a beat.
  const [highlightId, setHighlightId] = useState<string | null>(null);
  const pageRefs = useRef<Record<number, HTMLDivElement | null>>({});

  // How many boxes already carry each type-field label (so the picker can flag what's
  // already placed vs still missing).
  const placedCounts = new Map<string, number>();
  for (const f of fields) placedCounts.set(f.detected_name, (placedCounts.get(f.detected_name) ?? 0) + 1);

  async function addOne(input: {
    label: string;
    type: string;
    role?: string;
    core_key?: string | null;
  }): Promise<boolean> {
    const pg = sizeOf(addPage);
    const { w, h } = sizeForType(input.type);
    // Drop it at page center; the admin drags it onto the real blank.
    const pos_x = Math.round(Math.max(0, (pg.width - w) / 2));
    const pos_y = Math.round(Math.max(0, (pg.height - h) / 2));
    setAddBusy(true);
    setAddError(null);
    try {
      const created = await onAddField({
        detected_name: input.label,
        detected_type: input.type,
        page_number: addPage,
        pos_x,
        pos_y,
        width: w,
        height: h,
        final_core_key: input.core_key ?? null,
        final_role: input.role || null,
      });
      setDirty(true);
      // Make the new box impossible to miss: jump to its page and flash it.
      setHighlightId(created.id);
      requestAnimationFrame(() =>
        pageRefs.current[created.page_number]?.scrollIntoView({ behavior: "smooth", block: "center" })
      );
      window.setTimeout(() => setHighlightId((cur) => (cur === created.id ? null : cur)), 2600);
      return true;
    } catch (e) {
      setAddError(e instanceof Error ? e.message : "Could not add the field");
      return false;
    } finally {
      setAddBusy(false);
    }
  }

  async function addCustom() {
    const label = customLabel.trim();
    if (!label) return;
    const ok = await addOne({ label, type: customType });
    if (ok) setCustomLabel("");
  }

  async function removeField(fieldId: string) {
    setSaving(true);
    try {
      await onDeleteField(fieldId);
      setDirty(true);
    } finally {
      setSaving(false);
    }
  }

  function onPointerDown(e: React.PointerEvent, f: AdminFormField, container: HTMLElement | null) {
    if (!container) return;
    e.preventDefault();
    drag.current = {
      id: f.id,
      startX: e.clientX,
      startY: e.clientY,
      start: fracOf(f),
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
          if (f.page_number === page) {
            const cur = next[f.id] ?? toFrac(f);
            next[f.id] = { ...cur, y: clamp01(cur.y - dy / pg.height) };
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
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setAdding((a) => !a)}
            className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm font-semibold ${
              adding
                ? "border-brand-navy bg-brand-navy/5 text-brand-navy"
                : "border-gray-300 text-gray-600 hover:bg-gray-50"
            }`}
          >
            <Plus size={15} /> Add field
          </button>
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
            fracOf={fracOf}
            highlight={highlightId}
            registerRef={(el) => {
              pageRefs.current[page] = el;
            }}
            nudge={pageNudge[page] ?? 0}
            onNudge={(v) => setPageNudge((p) => ({ ...p, [page]: v }))}
            onNudgeCommit={() => commitNudge(page)}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onDelete={removeField}
          />
        );
      })}

      {adding && (
        <AddFieldDrawer
          typeFields={typeFields}
          pageNums={pageNums}
          addPage={addPage}
          setAddPage={setAddPage}
          search={search}
          setSearch={setSearch}
          placedCounts={placedCounts}
          busy={addBusy}
          error={addError}
          onPick={addOne}
          customLabel={customLabel}
          setCustomLabel={setCustomLabel}
          customType={customType}
          setCustomType={setCustomType}
          onAddCustom={addCustom}
          onClose={() => setAdding(false)}
        />
      )}
    </div>
  );
}

function PageCanvas({
  formId,
  page,
  aspect,
  pageHeight,
  fields,
  fracOf,
  highlight,
  registerRef,
  nudge,
  onNudge,
  onNudgeCommit,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onDelete,
}: {
  formId: string;
  page: number;
  aspect: number;
  pageHeight: number;
  fields: AdminFormField[];
  fracOf: (f: AdminFormField) => Frac;
  highlight: string | null;
  registerRef: (el: HTMLDivElement | null) => void;
  nudge: number;
  onNudge: (v: number) => void;
  onNudgeCommit: () => void;
  onPointerDown: (e: React.PointerEvent, f: AdminFormField, container: HTMLElement | null) => void;
  onPointerMove: (e: React.PointerEvent) => void;
  onPointerUp: (e: React.PointerEvent) => void;
  onDelete: (fieldId: string) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  // Live nudge as a fraction of the page (subtract from each box's top).
  const nudgeFrac = nudge / pageHeight;
  return (
    <div ref={registerRef} className="overflow-hidden rounded-lg border border-gray-200 scroll-mt-20">
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
          const b = fracOf(f);
          const core = f.tier === "core";
          const hot = f.id === highlight;
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
              } ${hot ? "z-20 animate-pulse ring-4 ring-amber-400 ring-offset-1" : "hover:z-10"}`}
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
              {/* Remove a box vision put on the wrong thing. */}
              <button
                type="button"
                onPointerDown={(e) => e.stopPropagation()}
                onClick={(e) => {
                  e.stopPropagation();
                  onDelete(f.id);
                }}
                title="Remove this field"
                className="absolute -right-2.5 -top-2.5 hidden rounded-full border border-gray-200 bg-white p-0.5 text-gray-400 shadow-sm group-hover:flex hover:text-red-600"
              >
                <Trash2 size={11} />
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/**
 * Slide-over picker for adding a field vision missed. Lists the document type's
 * master field set (missing ones first), plus a custom-field escape hatch. Adding
 * drops a box on the chosen page; the admin then drags it onto the blank. No
 * backdrop — the form stays draggable alongside.
 */
function AddFieldDrawer({
  typeFields,
  pageNums,
  addPage,
  setAddPage,
  search,
  setSearch,
  placedCounts,
  busy,
  error,
  onPick,
  customLabel,
  setCustomLabel,
  customType,
  setCustomType,
  onAddCustom,
  onClose,
}: {
  typeFields: TypeFieldOption[];
  pageNums: number[];
  addPage: number;
  setAddPage: (n: number) => void;
  search: string;
  setSearch: (s: string) => void;
  placedCounts: Map<string, number>;
  busy: boolean;
  error: string | null;
  onPick: (input: { label: string; type: string; role?: string; core_key?: string | null }) => void;
  customLabel: string;
  setCustomLabel: (s: string) => void;
  customType: string;
  setCustomType: (s: string) => void;
  onAddCustom: () => void;
  onClose: () => void;
}) {
  const q = search.trim().toLowerCase();
  const matches = typeFields
    .filter((f) => !q || f.label.toLowerCase().includes(q) || f.role.toLowerCase().includes(q))
    // Missing fields first, then core before common, then alphabetical.
    .sort((a, b) => {
      const pa = placedCounts.get(a.label) ? 1 : 0;
      const pb = placedCounts.get(b.label) ? 1 : 0;
      if (pa !== pb) return pa - pb;
      if (a.tier !== b.tier) return a.tier === "core" ? -1 : 1;
      return a.label.localeCompare(b.label);
    });

  return (
    <div className="fixed right-0 top-0 z-30 flex h-full w-80 flex-col border-l border-gray-200 bg-white shadow-xl">
      <div className="flex items-center justify-between border-b border-gray-100 px-4 py-3">
        <div>
          <h3 className="text-sm font-bold text-brand-navy">Add a field</h3>
          <p className="text-[11px] text-gray-400">Drops a box on the page you pick — then drag it onto the blank.</p>
        </div>
        <button type="button" onClick={onClose} className="rounded p-1 text-gray-400 hover:bg-gray-100" title="Close">
          <X size={16} />
        </button>
      </div>

      <div className="flex items-center gap-2 border-b border-gray-100 px-4 py-2">
        <label className="text-xs font-semibold text-gray-500">Page</label>
        <select
          value={addPage}
          onChange={(e) => setAddPage(Number(e.target.value))}
          className="rounded border border-gray-300 px-2 py-1 text-sm"
        >
          {pageNums.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search fields…"
          className="ml-auto w-36 rounded border border-gray-300 px-2 py-1 text-sm"
        />
      </div>

      <div className="flex-1 overflow-y-auto px-2 py-2">
        {matches.length === 0 && (
          <p className="px-2 py-4 text-center text-xs text-gray-400">No matching fields.</p>
        )}
        <ul className="space-y-0.5">
          {matches.map((f) => {
            const placed = placedCounts.get(f.label) ?? 0;
            return (
              <li key={f.label}>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => onPick({ label: f.label, type: f.type, role: f.role, core_key: f.core_key })}
                  className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-gray-50 disabled:opacity-50"
                >
                  <span
                    className={`h-2 w-2 shrink-0 rounded-full ${f.tier === "core" ? "bg-red-500" : "bg-blue-500"}`}
                    title={f.tier}
                  />
                  <span className="min-w-0 flex-1 truncate">
                    <span className="font-medium text-gray-700">{f.label}</span>
                    {f.role ? <span className="ml-1 text-[11px] text-gray-400">· {f.role}</span> : null}
                  </span>
                  {placed > 0 ? (
                    <span className="shrink-0 rounded-full bg-green-50 px-1.5 text-[10px] font-semibold text-green-600">
                      placed{placed > 1 ? ` ×${placed}` : ""}
                    </span>
                  ) : (
                    <Plus size={13} className="shrink-0 text-gray-300" />
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      </div>

      <div className="border-t border-gray-100 px-4 py-3">
        {error && (
          <p className="mb-2 rounded bg-red-50 px-2 py-1 text-xs text-red-600">{error}</p>
        )}
        <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-gray-400">Custom field</p>
        <div className="flex items-center gap-1.5">
          <input
            value={customLabel}
            onChange={(e) => setCustomLabel(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && customLabel.trim() && !busy) onAddCustom();
            }}
            placeholder="label"
            className="min-w-0 flex-1 rounded border border-gray-300 px-2 py-1 text-sm"
          />
          <select
            value={customType}
            onChange={(e) => setCustomType(e.target.value)}
            className="rounded border border-gray-300 px-1 py-1 text-xs"
          >
            {FIELD_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
          <button
            type="button"
            disabled={busy || !customLabel.trim()}
            onClick={onAddCustom}
            className="rounded bg-brand-navy px-2.5 py-1 text-sm font-semibold text-white disabled:opacity-40"
          >
            Add
          </button>
        </div>
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
