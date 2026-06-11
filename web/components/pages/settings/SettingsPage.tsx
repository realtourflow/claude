"use client";

import { useState } from 'react';
import Image from "next/image";
import {
  User, Store, Bell, Plug, Star, Pencil, Trash2,
  ChevronUp, ChevronDown, Plus, X, Check, ExternalLink,
  Phone, Mail, Users, UserCheck, FileText, Upload,
} from 'lucide-react';
import { useAuthStore } from "@/lib/store/authStore";
import { useTC, useMyAgents } from "@/hooks/useTC";
import { useAgentDocs, DocType, DOC_TYPE_LABELS, AgentDocTemplate } from "@/hooks/useAgentDocs";
import {
  VendorCategory,
  VENDOR_CATEGORY_LABELS,
  VENDOR_CATEGORY_ORDER,
} from "@/lib/data/mockVendors";
import { useVendors, Vendor, VendorInput } from "@/hooks/useVendors";
import { useSettings } from "@/hooks/useSettings";
import { useMLSConnection } from "@/hooks/useMLS";
import { uploadAgentPhoto } from "@/hooks/useAgentPhoto";
import { useIntegrations } from "@/hooks/useIntegrations";
import { settingsTabFromSearch } from "@/lib/settings-nav";

// ─── Tabs ─────────────────────────────────────────────────────────────────────

type Tab = 'profile' | 'tc' | 'vendors' | 'my_agents' | 'notifications' | 'integrations' | 'documents';

// Tabs vary by role — built dynamically in the main component

// ─── Vendor Modal ─────────────────────────────────────────────────────────────

type VendorFormData = VendorInput;

const EMPTY_FORM = (): VendorFormData => ({
  category: 'home_inspector',
  company: '',
  contactName: '',
  phone: '',
  email: '',
  website: '',
  notes: '',
  isFeatured: false,
});

function VendorModal({
  initial,
  defaultCategory,
  onSave,
  onClose,
}: {
  initial?: Vendor;
  defaultCategory?: VendorCategory;
  onSave: (data: VendorFormData) => Promise<void> | void;
  onClose: () => void;
}) {
  const [form, setForm] = useState<VendorFormData>(() => {
    if (initial) return { ...initial };
    const base = EMPTY_FORM();
    if (defaultCategory) base.category = defaultCategory;
    return base;
  });
  const [saving, setSaving] = useState(false);
  const [saveErr, setSaveErr] = useState('');

  function set<K extends keyof VendorFormData>(k: K, v: VendorFormData[K]) {
    setForm((f) => ({ ...f, [k]: v }));
  }

  const isEdit = !!initial;
  const canSave = form.company.trim().length > 0 && !saving;

  async function handleClick() {
    if (!canSave) return;
    setSaving(true);
    setSaveErr('');
    try {
      await onSave(form);
    } catch (e) {
      setSaveErr(e instanceof Error ? e.message : 'Failed to save vendor. Please try again.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative w-full max-w-md rounded-t-3xl sm:rounded-2xl bg-white shadow-2xl overflow-hidden max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between border-b px-5 py-4 flex-shrink-0">
          <h2 className="font-bold text-brand-navy">
            {isEdit ? 'Edit Vendor' : 'Add Vendor'}
          </h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 transition-colors">
            <X size={18} />
          </button>
        </div>

        {/* Form */}
        <div className="overflow-y-auto flex-1 px-5 py-4 space-y-4">
          {/* Category */}
          <div>
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wider text-gray-400">
              Category
            </label>
            <select
              value={form.category}
              onChange={(e) => set('category', e.target.value as VendorCategory)}
              disabled={isEdit}
              className="w-full rounded-xl border border-gray-200 bg-gray-50 px-4 py-2.5 text-sm text-gray-800 outline-none focus:border-brand-navy/30 focus:ring-2 focus:ring-brand-navy/10 disabled:opacity-60"
            >
              {VENDOR_CATEGORY_ORDER.map((cat) => (
                <option key={cat} value={cat}>
                  {VENDOR_CATEGORY_LABELS[cat]}
                </option>
              ))}
            </select>
          </div>

          {/* Company */}
          <div>
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wider text-gray-400">
              Company <span className="text-red-400">*</span>
            </label>
            <input
              value={form.company}
              onChange={(e) => set('company', e.target.value)}
              placeholder="e.g. BirminghamHome Inspections"
              className="w-full rounded-xl border border-gray-200 bg-gray-50 px-4 py-2.5 text-sm text-gray-800 outline-none focus:border-brand-navy/30 focus:ring-2 focus:ring-brand-navy/10"
            />
          </div>

          {/* Contact name */}
          <div>
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wider text-gray-400">
              Contact name
            </label>
            <input
              value={form.contactName ?? ''}
              onChange={(e) => set('contactName', e.target.value)}
              placeholder="e.g. Ray Simmons"
              className="w-full rounded-xl border border-gray-200 bg-gray-50 px-4 py-2.5 text-sm text-gray-800 outline-none focus:border-brand-navy/30 focus:ring-2 focus:ring-brand-navy/10"
            />
          </div>

          {/* Phone + Email */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs font-semibold uppercase tracking-wider text-gray-400">
                Phone
              </label>
              <input
                value={form.phone ?? ''}
                onChange={(e) => set('phone', e.target.value)}
                placeholder="(205) 555-0188"
                className="w-full rounded-xl border border-gray-200 bg-gray-50 px-3 py-2.5 text-sm text-gray-800 outline-none focus:border-brand-navy/30 focus:ring-2 focus:ring-brand-navy/10"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold uppercase tracking-wider text-gray-400">
                Email
              </label>
              <input
                type="email"
                value={form.email ?? ''}
                onChange={(e) => set('email', e.target.value)}
                placeholder="name@company.com"
                className="w-full rounded-xl border border-gray-200 bg-gray-50 px-3 py-2.5 text-sm text-gray-800 outline-none focus:border-brand-navy/30 focus:ring-2 focus:ring-brand-navy/10"
              />
            </div>
          </div>

          {/* Website */}
          <div>
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wider text-gray-400">
              Website
            </label>
            <input
              value={form.website ?? ''}
              onChange={(e) => set('website', e.target.value)}
              placeholder="https://..."
              className="w-full rounded-xl border border-gray-200 bg-gray-50 px-4 py-2.5 text-sm text-gray-800 outline-none focus:border-brand-navy/30 focus:ring-2 focus:ring-brand-navy/10"
            />
          </div>

          {/* Notes */}
          <div>
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wider text-gray-400">
              Notes <span className="font-normal normal-case text-gray-300">(shown to clients)</span>
            </label>
            <textarea
              value={form.notes ?? ''}
              onChange={(e) => set('notes', e.target.value)}
              placeholder='e.g. "Ask for Mike" or "Best for older homes"'
              rows={2}
              className="w-full rounded-xl border border-gray-200 bg-gray-50 px-4 py-2.5 text-sm text-gray-800 outline-none focus:border-brand-navy/30 focus:ring-2 focus:ring-brand-navy/10 resize-none"
            />
          </div>

          {/* Featured */}
          <button
            onClick={() => set('isFeatured', !form.isFeatured)}
            className={[
              'flex w-full items-center gap-3 rounded-xl border-2 px-4 py-3 transition-all',
              form.isFeatured
                ? 'border-brand-gold bg-brand-gold/10'
                : 'border-gray-100 bg-gray-50 hover:border-gray-200',
            ].join(' ')}
          >
            <Star
              size={18}
              className={form.isFeatured ? 'fill-brand-gold text-brand-gold' : 'text-gray-300'}
            />
            <div className="text-left">
              <div className="text-sm font-semibold text-brand-navy">Featured vendor</div>
              <div className="text-xs text-gray-400">Shown as top pick in this category for your clients</div>
            </div>
            {form.isFeatured && <Check size={15} className="ml-auto text-brand-gold" />}
          </button>
        </div>

        {/* Footer */}
        <div className="border-t px-5 py-4 flex flex-col gap-2 flex-shrink-0">
          {saveErr && (
            <p className="text-xs text-red-600 text-center">{saveErr}</p>
          )}
          <div className="flex gap-3">
            <button
              onClick={onClose}
              disabled={saving}
              className="flex-1 rounded-xl border border-gray-200 py-2.5 text-sm font-semibold text-gray-500 hover:bg-gray-50 transition-colors disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              onClick={handleClick}
              disabled={!canSave}
              className={[
                'flex-1 rounded-xl py-2.5 text-sm font-bold transition-all',
                canSave
                  ? 'bg-brand-navy text-white hover:bg-brand-navy/90'
                  : 'cursor-not-allowed bg-gray-100 text-gray-300',
              ].join(' ')}
            >
              {saving ? 'Saving…' : isEdit ? 'Save changes' : 'Add vendor'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Vendors Section ──────────────────────────────────────────────────────────

function VendorsSection({ agentId: _agentId }: { agentId: string }) {
  const { vendors, addVendor, updateVendor, deleteVendor, moveVendor, toggleFeatured } =
    useVendors();

  const [modal, setModal] = useState<
    { mode: 'add'; category: VendorCategory } | { mode: 'edit'; vendor: Vendor } | null
  >(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  async function handleSave(data: VendorFormData) {
    if (modal?.mode === 'edit') {
      await updateVendor(modal.vendor.id, data);
    } else if (modal?.mode === 'add') {
      await addVendor({ ...data, category: modal.category });
    }
    setModal(null);
  }

  const modalCategory =
    modal?.mode === 'add' ? modal.category :
    modal?.mode === 'edit' ? modal.vendor.category :
    undefined;

  return (
    <div className="space-y-1">
      <p className="mb-5 text-sm text-gray-400">
        These vendors appear in your clients&apos; portals under &quot;Preferred Vendors.&quot; Changes apply to all active deals.
      </p>

      {VENDOR_CATEGORY_ORDER.map((category) => {
        const catVendors = vendors.filter((v) => v.category === category);

        return (
          <div key={category} className="rounded-2xl bg-white shadow-sm overflow-hidden">
            {/* Category header */}
            <div className="flex items-center justify-between border-b border-gray-50 px-4 py-3">
              <div className="flex items-center gap-2">
                <span className="text-sm font-bold text-brand-navy">
                  {VENDOR_CATEGORY_LABELS[category]}
                </span>
                {catVendors.length > 0 && (
                  <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-semibold text-gray-500">
                    {catVendors.length}
                  </span>
                )}
              </div>
              <button
                onClick={() => setModal({ mode: 'add', category })}
                className="flex items-center gap-1 rounded-lg bg-brand-navy/5 px-2.5 py-1 text-xs font-semibold text-brand-navy hover:bg-brand-navy/10 transition-colors"
              >
                <Plus size={12} /> Add
              </button>
            </div>

            {/* Vendor rows */}
            {catVendors.length === 0 ? (
              <div className="px-4 py-3 text-xs text-gray-300 italic">No vendors added yet</div>
            ) : (
              <div className="divide-y divide-gray-50">
                {catVendors.map((v, posInCat) => (
                  <div key={v.id} className="flex items-center gap-3 px-4 py-3">
                    {/* Featured star */}
                    <button
                      onClick={() => toggleFeatured(v.id)}
                      title={v.isFeatured ? 'Remove featured' : 'Mark as featured'}
                      className="flex-shrink-0"
                    >
                      <Star
                        size={15}
                        className={
                          v.isFeatured
                            ? 'fill-brand-gold text-brand-gold'
                            : 'text-gray-200 hover:text-gray-300 transition-colors'
                        }
                      />
                    </button>

                    {/* Info */}
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-semibold text-brand-navy truncate">
                        {v.company}
                      </div>
                      <div className="flex items-center gap-2 mt-0.5">
                        {v.contactName && (
                          <span className="text-xs text-gray-400 truncate">{v.contactName}</span>
                        )}
                        {v.phone && (
                          <span className="flex items-center gap-0.5 text-xs text-gray-300">
                            <Phone size={10} /> {v.phone}
                          </span>
                        )}
                        {v.email && (
                          <span className="flex items-center gap-0.5 text-xs text-gray-300">
                            <Mail size={10} />
                          </span>
                        )}
                      </div>
                      {v.notes && (
                        <div className="mt-0.5 text-xs text-gray-400 italic truncate">{v.notes}</div>
                      )}
                    </div>

                    {/* Reorder */}
                    <div className="flex flex-col gap-0.5 flex-shrink-0">
                      <button
                        onClick={() => moveVendor(v.id, 'up')}
                        disabled={posInCat === 0}
                        className="rounded p-0.5 text-gray-200 hover:text-gray-400 disabled:opacity-0 transition-colors"
                      >
                        <ChevronUp size={13} />
                      </button>
                      <button
                        onClick={() => moveVendor(v.id, 'down')}
                        disabled={posInCat === catVendors.length - 1}
                        className="rounded p-0.5 text-gray-200 hover:text-gray-400 disabled:opacity-0 transition-colors"
                      >
                        <ChevronDown size={13} />
                      </button>
                    </div>

                    {/* Edit */}
                    <button
                      onClick={() => setModal({ mode: 'edit', vendor: v })}
                      className="flex-shrink-0 rounded-lg p-1.5 text-gray-300 hover:bg-gray-100 hover:text-gray-500 transition-colors"
                    >
                      <Pencil size={13} />
                    </button>

                    {/* Delete */}
                    {confirmDelete === v.id ? (
                      <div className="flex items-center gap-1 flex-shrink-0">
                        <button
                          onClick={() => { deleteVendor(v.id); setConfirmDelete(null); }}
                          className="rounded-lg bg-red-500 px-2 py-1 text-xs font-bold text-white hover:bg-red-600 transition-colors"
                        >
                          Delete
                        </button>
                        <button
                          onClick={() => setConfirmDelete(null)}
                          className="rounded-lg px-2 py-1 text-xs font-semibold text-gray-400 hover:bg-gray-100 transition-colors"
                        >
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={() => setConfirmDelete(v.id)}
                        className="flex-shrink-0 rounded-lg p-1.5 text-gray-300 hover:bg-red-50 hover:text-red-400 transition-colors"
                      >
                        <Trash2 size={13} />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}

      {/* Modal */}
      {modal && (
        <VendorModal
          initial={modal.mode === 'edit' ? modal.vendor : undefined}
          defaultCategory={modalCategory}
          onSave={handleSave}
          onClose={() => setModal(null)}
        />
      )}
      {modal && (
        <div
          className="fixed inset-0 z-40"
          onClick={() => setModal(null)}
        />
      )}
    </div>
  );
}

// ─── Profile Section ──────────────────────────────────────────────────────────

function ProfileSection() {
  const { activeUser } = useAuthStore();
  const { settings, loading: settingsLoading, saveSettings, saveProfile } = useSettings();
  const [form, setForm] = useState({
    name: activeUser?.name ?? '',
    phone: '',
    title: '',
    licenseNumber: '',
    bio: '',
  });
  const [photoUrl, setPhotoUrl] = useState<string>('');
  const [photoUploading, setPhotoUploading] = useState(false);
  const [photoErr, setPhotoErr] = useState('');
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);

  // React 19 pattern for "hydrate local form state from fetched settings":
  // compare to previous value during render rather than syncing in useEffect.
  // The onboarding flow writes these into the settings JSONB, so we prefer
  // those values over the empty initial form state.
  const [prevSettings, setPrevSettings] = useState(settings);
  if (!settingsLoading && settings !== prevSettings) {
    setPrevSettings(settings);
    setForm((f) => ({
      ...f,
      name: (settings.name as string) ?? f.name,
      phone: (settings.phone as string) ?? '',
      title: (settings.title as string) ?? '',
      licenseNumber: (settings.licenseNumber as string) ?? '',
      bio: (settings.bio as string) ?? '',
    }));
    setPhotoUrl((settings.photoUrl as string) ?? '');
  }

  async function handleSave() {
    setSaving(true);
    try {
      await Promise.all([
        saveProfile(form.name, form.phone),
        saveSettings({
          name: form.name,
          phone: form.phone,
          title: form.title,
          licenseNumber: form.licenseNumber,
          bio: form.bio,
        }),
      ]);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch {
      // Error handling — could add toast here
    } finally {
      setSaving(false);
    }
  }

  async function handlePhotoChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      setPhotoErr('Please choose an image file.');
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setPhotoErr('Image is too large — max 5 MB.');
      return;
    }
    setPhotoErr('');
    setPhotoUploading(true);
    try {
      const url = await uploadAgentPhoto(file);
      setPhotoUrl(url);
      await saveSettings({ photoUrl: url });
    } catch (err) {
      setPhotoErr(err instanceof Error ? err.message : 'Upload failed.');
    } finally {
      setPhotoUploading(false);
    }
  }

  const initials = (form.name || activeUser?.email || '?')
    .split(/[\s@]/)
    .filter(Boolean)
    .slice(0, 2)
    .map((s) => s[0]?.toUpperCase() ?? '')
    .join('');

  return (
    <div className="space-y-5 max-w-lg">
      {/* Avatar */}
      <div className="flex items-center gap-4">
        <div className="relative h-16 w-16 flex-shrink-0">
          {photoUrl ? (
            <Image
              src={photoUrl}
              alt={form.name || 'Headshot'}
              width={64}
              height={64}
              unoptimized
              className="h-16 w-16 rounded-2xl ring-2 ring-brand-navy/10 object-cover"
            />
          ) : (
            <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-brand-navy/10 ring-2 ring-brand-navy/10 text-lg font-bold text-brand-navy">
              {initials || '?'}
            </div>
          )}
          <label className="absolute -bottom-1 -right-1 flex h-7 w-7 cursor-pointer items-center justify-center rounded-full bg-brand-navy text-white shadow-sm hover:bg-brand-navy/90 transition-colors">
            {photoUploading ? (
              <span className="text-[10px] font-bold">…</span>
            ) : (
              <Upload size={12} />
            )}
            <input
              type="file"
              accept="image/*"
              className="hidden"
              onChange={handlePhotoChange}
              disabled={photoUploading}
            />
          </label>
        </div>
        <div className="min-w-0">
          <div className="text-sm font-bold text-brand-navy truncate">{form.name || activeUser?.email}</div>
          <div className="text-xs text-gray-400 truncate">{activeUser?.email}</div>
          <div className="mt-1 rounded-full bg-brand-navy/5 px-2 py-0.5 text-xs font-semibold text-brand-navy inline-block">
            {activeUser?.role}
          </div>
          {photoErr && <p className="mt-1 text-xs text-red-500">{photoErr}</p>}
        </div>
      </div>

      <div className="rounded-2xl bg-white shadow-sm divide-y divide-gray-50 overflow-hidden">
        {[
          { label: 'Full name', key: 'name', placeholder: 'Your name' },
          { label: 'Phone', key: 'phone', placeholder: '(205) 555-0100' },
          { label: 'Title', key: 'title', placeholder: 'e.g. Realtor, Senior Agent' },
          { label: 'License #', key: 'licenseNumber', placeholder: 'e.g. AL-012345' },
        ].map(({ label, key, placeholder }) => (
          <div key={key} className="flex items-center gap-4 px-5 py-3.5">
            <label className="w-28 flex-shrink-0 text-xs font-semibold text-gray-400 uppercase tracking-wide">
              {label}
            </label>
            <input
              value={form[key as keyof typeof form]}
              onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))}
              placeholder={placeholder}
              className="flex-1 rounded-lg border border-transparent bg-gray-50 px-3 py-1.5 text-sm text-gray-800 outline-none focus:border-brand-navy/20 focus:bg-white focus:ring-2 focus:ring-brand-navy/10 transition-all"
            />
          </div>
        ))}

        {/* Bio */}
        <div className="px-5 py-3.5">
          <label className="mb-2 block text-xs font-semibold text-gray-400 uppercase tracking-wide">
            Bio <span className="font-normal normal-case text-gray-300">(shown to clients)</span>
          </label>
          <textarea
            value={form.bio}
            onChange={(e) => setForm((f) => ({ ...f, bio: e.target.value }))}
            placeholder="A short introduction that your clients will see in their portal..."
            rows={3}
            className="w-full rounded-lg border border-transparent bg-gray-50 px-3 py-2 text-sm text-gray-800 outline-none focus:border-brand-navy/20 focus:bg-white focus:ring-2 focus:ring-brand-navy/10 transition-all resize-none"
          />
        </div>
      </div>

      {/* Email note */}
      <p className="text-xs text-gray-300">
        Email address is managed by your admin and cannot be changed here.
      </p>

      <button
        onClick={handleSave}
        disabled={saving}
        className={[
          'flex items-center gap-2 rounded-xl px-5 py-2.5 text-sm font-bold transition-all',
          saved
            ? 'bg-green-500 text-white'
            : saving
            ? 'bg-brand-navy/60 text-white cursor-not-allowed'
            : 'bg-brand-navy text-white hover:bg-brand-navy/90 active:scale-[0.98]',
        ].join(' ')}
      >
        {saved ? <><Check size={15} /> Saved</> : saving ? 'Saving…' : 'Save profile'}
      </button>
    </div>
  );
}

// ─── Notifications Section ────────────────────────────────────────────────────

const NOTIFICATION_ITEMS = [
  {
    group: 'Deals',
    items: [
      { id: 'deal_stage', label: 'Deal stage changes', sub: 'When a deal advances or falls back a stage' },
      { id: 'new_task', label: 'New task assigned to me', sub: 'When a task is created and assigned to you' },
      { id: 'overdue_task', label: 'Overdue task alert', sub: 'Daily reminder for tasks past their due date' },
    ],
  },
  {
    group: 'Clients',
    items: [
      { id: 'fastpass_enroll', label: 'Fast Pass enrollment', sub: 'When a client submits a Fast Pass request' },
      { id: 'disclosure_reminder', label: 'Disclosure reminder', sub: 'When disclosures are sent but unsigned for 48+ hours' },
      { id: 'new_message', label: 'New client message', sub: 'When a client sends a message through the portal' },
    ],
  },
  {
    group: 'Delivery',
    items: [
      { id: 'email', label: 'Email notifications', sub: 'Receive alerts via email' },
      { id: 'push', label: 'Push / text notifications', sub: 'Receive alerts via SMS or push' },
    ],
  },
];

const NOTIFICATION_DEFAULTS: Record<string, boolean> = {
  deal_stage: true,
  new_task: true,
  overdue_task: true,
  fastpass_enroll: true,
  disclosure_reminder: true,
  new_message: false,
  email: true,
  push: false,
};

function NotificationsSection() {
  const { settings, loading, saveSettings } = useSettings();
  const [enabled, setEnabled] = useState<Record<string, boolean>>(NOTIFICATION_DEFAULTS);

  // React 19 pattern: compare to previous notifications during render to
  // hydrate local state when settings finish loading.
  const [prevNotifs, setPrevNotifs] = useState(settings.notifications);
  if (!loading && settings.notifications && settings.notifications !== prevNotifs) {
    setPrevNotifs(settings.notifications);
    setEnabled({ ...NOTIFICATION_DEFAULTS, ...(settings.notifications as Record<string, boolean>) });
  }

  function toggle(id: string) {
    const updated = { ...enabled, [id]: !enabled[id] };
    setEnabled(updated);
    saveSettings({ notifications: updated });
  }

  return (
    <div className="space-y-5 max-w-lg">
      {NOTIFICATION_ITEMS.map(({ group, items }) => (
        <div key={group}>
          <h3 className="mb-2 text-xs font-bold uppercase tracking-wider text-gray-400">{group}</h3>
          <div className="rounded-2xl bg-white shadow-sm divide-y divide-gray-50 overflow-hidden">
            {items.map(({ id, label, sub }) => (
              <div key={id} className="flex items-center justify-between px-5 py-3.5">
                <div className="flex-1 min-w-0 pr-4">
                  <div className="text-sm font-semibold text-brand-navy">{label}</div>
                  <div className="text-xs text-gray-400 mt-0.5">{sub}</div>
                </div>
                <button
                  onClick={() => toggle(id)}
                  className={[
                    'relative inline-flex h-6 w-11 flex-shrink-0 items-center rounded-full transition-colors',
                    enabled[id] ? 'bg-brand-navy' : 'bg-gray-200',
                  ].join(' ')}
                >
                  <span
                    className={[
                      'inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform',
                      enabled[id] ? 'translate-x-6' : 'translate-x-1',
                    ].join(' ')}
                  />
                </button>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── Integrations Section ─────────────────────────────────────────────────────

function MLSCard() {
  const { connected, loading, saveMLS, disconnectMLS } = useMLSConnection();
  const [expanded, setExpanded] = useState(false);
  const [keyInput, setKeyInput] = useState('');
  const [secretInput, setSecretInput] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveErr, setSaveErr] = useState('');
  const [saved, setSaved] = useState(false);
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);

  async function handleSave() {
    if (!keyInput.trim() || !secretInput.trim() || saving) return;
    setSaving(true);
    setSaveErr('');
    try {
      await saveMLS(keyInput.trim(), secretInput.trim());
      setSaved(true);
      setExpanded(false);
      setKeyInput('');
      setSecretInput('');
      setTimeout(() => setSaved(false), 3000);
    } catch (e: unknown) {
      setSaveErr(e instanceof Error ? e.message : 'Failed to save — check your credentials');
    }
    setSaving(false);
  }

  async function handleDisconnect() {
    await disconnectMLS().catch(() => {});
    setConfirmDisconnect(false);
  }

  return (
    <div className="rounded-2xl bg-white shadow-sm overflow-hidden">
      <div className="flex items-start gap-4 p-5">
        <div className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-xl bg-gray-50 text-2xl">
          🏠
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-bold text-brand-navy text-sm">SimplyRETS MLS</span>
            {!loading && connected && (
              <span className="flex items-center gap-1 rounded-full bg-green-100 px-2 py-0.5 text-[10px] font-bold text-green-700">
                <Check size={9} strokeWidth={3} /> Connected
              </span>
            )}
            {saved && (
              <span className="flex items-center gap-1 rounded-full bg-green-100 px-2 py-0.5 text-[10px] font-bold text-green-700">
                <Check size={9} strokeWidth={3} /> Saved!
              </span>
            )}
          </div>
          <p className="mt-1 text-xs text-gray-400 leading-relaxed">
            Connect your SimplyRETS account to show live MLS listings to buyers in their portal. Buyers can browse active listings and add homes to their tracked list.
          </p>
          {!loading && connected && (
            <p className="mt-1 text-xs text-green-600 font-medium">Live MLS listings are active in all buyer portals</p>
          )}
        </div>
      </div>

      {/* Credential form */}
      {expanded && (
        <div className="border-t border-gray-50 px-5 py-4 space-y-3 bg-gray-50/50">
          <p className="text-[11px] text-gray-400 leading-relaxed">
            Enter your SimplyRETS API credentials. Find them at{' '}
            <span className="font-semibold text-brand-navy">app.simplyrets.com</span> under your app settings.
          </p>
          <div className="space-y-2">
            <input
              type="text"
              value={keyInput}
              onChange={(e) => setKeyInput(e.target.value)}
              placeholder="API Key (username)"
              className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-800 outline-none focus:border-brand-navy/30 focus:ring-2 focus:ring-brand-navy/10"
            />
            <input
              type="password"
              value={secretInput}
              onChange={(e) => setSecretInput(e.target.value)}
              placeholder="API Secret (password)"
              className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-800 outline-none focus:border-brand-navy/30 focus:ring-2 focus:ring-brand-navy/10"
            />
          </div>
          {saveErr && <p className="text-xs text-red-500">{saveErr}</p>}
          <div className="flex gap-2">
            <button
              onClick={handleSave}
              disabled={!keyInput.trim() || !secretInput.trim() || saving}
              className="flex items-center gap-1.5 rounded-lg bg-brand-navy px-4 py-2 text-xs font-bold text-white hover:bg-brand-navy/90 transition-colors disabled:opacity-40"
            >
              <Check size={12} /> {saving ? 'Verifying…' : 'Save & connect'}
            </button>
            <button
              onClick={() => { setExpanded(false); setKeyInput(''); setSecretInput(''); setSaveErr(''); }}
              className="rounded-lg border border-gray-200 px-3 py-2 text-xs font-semibold text-gray-500 hover:bg-gray-100 transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      <div className="border-t border-gray-50 px-5 py-3 flex items-center justify-between">
        {!loading && !connected && !expanded && (
          <button
            onClick={() => setExpanded(true)}
            className="flex items-center gap-1.5 rounded-lg bg-brand-navy px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand-navy/90 transition-colors"
          >
            <ExternalLink size={11} /> Connect SimplyRETS
          </button>
        )}
        {!loading && connected && !confirmDisconnect && (
          <div className="flex items-center gap-3">
            <button
              onClick={() => setExpanded(!expanded)}
              className="flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-semibold text-gray-500 hover:bg-gray-50 transition-colors"
            >
              <Pencil size={11} /> Update credentials
            </button>
            <button
              onClick={() => setConfirmDisconnect(true)}
              className="text-xs text-gray-300 hover:text-red-400 transition-colors"
            >
              Disconnect
            </button>
          </div>
        )}
        {confirmDisconnect && (
          <div className="flex items-center gap-2">
            <span className="text-xs text-gray-500">Remove MLS connection?</span>
            <button onClick={handleDisconnect} className="rounded-lg bg-red-500 px-3 py-1.5 text-xs font-bold text-white hover:bg-red-600">
              Disconnect
            </button>
            <button onClick={() => setConfirmDisconnect(false)} className="text-xs text-gray-400 hover:text-gray-600">
              Cancel
            </button>
          </div>
        )}
        {loading && <span className="text-xs text-gray-300">Loading…</span>}
        {!loading && !connected && !expanded && (
          <span className="text-xs text-gray-300">Live MLS listings for buyer portals</span>
        )}
      </div>
    </div>
  );
}

// Compact card layout used for every integration row so the section reads
// consistently regardless of whether the integration is platform-wide or
// per-agent.
function IntegrationCard({
  logo, name, description, statusBadge, primaryAction, secondaryAction, footnote,
}: {
  logo: string;
  name: string;
  description: string;
  statusBadge?: { label: string; color: 'green' | 'amber' | 'gray' };
  primaryAction?: { label: string; onClick: () => void; disabled?: boolean };
  secondaryAction?: { label: string; onClick: () => void };
  footnote?: string;
}) {
  const badgeColor =
    statusBadge?.color === 'green' ? 'bg-green-100 text-green-700'
    : statusBadge?.color === 'amber' ? 'bg-amber-100 text-amber-800'
    : 'bg-gray-100 text-gray-500';

  return (
    <div className="rounded-2xl bg-white shadow-sm overflow-hidden">
      <div className="flex items-start gap-4 p-5">
        <div className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-xl bg-gray-50 text-2xl">
          {logo}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-bold text-brand-navy text-sm">{name}</span>
            {statusBadge && (
              <span className={`flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold ${badgeColor}`}>
                {statusBadge.label}
              </span>
            )}
          </div>
          <p className="mt-1 text-xs text-gray-400 leading-relaxed">{description}</p>
          {footnote && (
            <p className="mt-1 text-xs text-gray-500">{footnote}</p>
          )}
        </div>
      </div>
      {(primaryAction || secondaryAction) && (
        <div className="border-t border-gray-50 px-5 py-3 flex items-center gap-3">
          {primaryAction && (
            <button
              onClick={primaryAction.onClick}
              disabled={primaryAction.disabled}
              className="flex items-center gap-1.5 rounded-lg bg-brand-navy px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand-navy/90 transition-colors disabled:opacity-40"
            >
              <ExternalLink size={11} />
              {primaryAction.label}
            </button>
          )}
          {secondaryAction && (
            <button
              onClick={secondaryAction.onClick}
              className="text-xs font-semibold text-gray-400 hover:text-red-500 transition-colors"
            >
              {secondaryAction.label}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function IntegrationsSection() {
  const { activeUser } = useAuthStore();
  const isAgent = activeUser?.groupId === 'agent' || activeUser?.groupId === 'admin';
  const { status, loading, error, startOAuth, disconnect, refresh } = useIntegrations();
  const [actionError, setActionError] = useState('');
  const [busy, setBusy] = useState<string | null>(null);

  // After the OAuth callback bounces the user back to /agent/settings?integrations=...
  // we surface a one-time toast so the agent sees that the connection landed
  // (or that it failed). React 19 pattern: capture the initial query state at
  // mount via a lazy useState initializer; setActionError gets called from
  // there exactly once.
  const [integrationsInitFlag] = useState<{ flag: string | null; reason: string | null }>(() => {
    if (typeof window === 'undefined') return { flag: null, reason: null };
    const params = new URLSearchParams(window.location.search);
    const flag = params.get('integrations');
    const reason = params.get('reason');
    if (flag) {
      // Clean the query string so a refresh doesn't keep showing the toast.
      params.delete('integrations');
      params.delete('reason');
      const newSearch = params.toString();
      window.history.replaceState({}, '', window.location.pathname + (newSearch ? `?${newSearch}` : ''));
    }
    return { flag, reason };
  });

  // Apply the initial query state. We use a one-shot guard so the side
  // effect (refresh + setActionError) only fires once.
  const [initApplied, setInitApplied] = useState(false);
  if (!initApplied && integrationsInitFlag.flag) {
    setInitApplied(true);
    if (integrationsInitFlag.flag.endsWith('_connected')) {
      void refresh();
    } else if (integrationsInitFlag.flag.endsWith('_error')) {
      setActionError(`Calendar connection failed: ${integrationsInitFlag.reason ?? 'unknown'}`);
    }
  }

  async function handleConnect(provider: 'google_calendar' | 'microsoft_calendar') {
    setBusy(provider);
    setActionError('');
    try {
      await startOAuth(provider);
      // startOAuth navigates away; we won't typically reach here.
    } catch (e) {
      setActionError(e instanceof Error ? e.message : 'Could not start connection.');
      setBusy(null);
    }
  }

  async function handleDisconnect(provider: 'google_calendar' | 'microsoft_calendar', label: string) {
    if (!window.confirm(`Disconnect ${label}? Existing calendar events stay in place; new milestones won't be pushed.`)) return;
    setBusy(provider);
    setActionError('');
    try {
      await disconnect(provider);
    } catch (e) {
      setActionError(e instanceof Error ? e.message : 'Could not disconnect.');
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-3 max-w-lg">
      {error && (
        <div className="rounded-xl bg-red-50 px-4 py-3 text-xs text-red-700">{error}</div>
      )}
      {actionError && (
        <div className="rounded-xl bg-red-50 px-4 py-3 text-xs text-red-700">{actionError}</div>
      )}

      {/* SimplyRETS MLS — agents only, real connection */}
      {isAgent && <MLSCard />}

      {/* Google Calendar — per-user OAuth */}
      <IntegrationCard
        logo="📅"
        name="Google Calendar"
        description="Push closing dates and task deadlines from RealTourFlow into your Google Calendar. Events update automatically when stages advance or due dates change."
        statusBadge={
          !status.google_calendar.configured
            ? { label: 'Not configured on server', color: 'gray' }
            : status.google_calendar.connected
            ? { label: status.google_calendar.account_email || 'Connected', color: 'green' }
            : { label: 'Not connected', color: 'amber' }
        }
        primaryAction={
          status.google_calendar.configured && !status.google_calendar.connected
            ? { label: busy === 'google_calendar' ? 'Opening…' : 'Connect Google Calendar', onClick: () => handleConnect('google_calendar'), disabled: busy === 'google_calendar' || loading }
            : undefined
        }
        secondaryAction={
          status.google_calendar.connected
            ? { label: busy === 'google_calendar' ? 'Disconnecting…' : 'Disconnect', onClick: () => handleDisconnect('google_calendar', 'Google Calendar') }
            : undefined
        }
        footnote={
          !status.google_calendar.configured
            ? 'Admin: set GOOGLE_OAUTH_CLIENT_ID / SECRET / REDIRECT_URL to enable.'
            : undefined
        }
      />

      {/* Microsoft Calendar — per-user OAuth */}
      <IntegrationCard
        logo="📆"
        name="Outlook / Office 365"
        description="Push deal milestones into Outlook via Microsoft Graph. Works with personal Microsoft accounts and Office 365 work accounts."
        statusBadge={
          !status.microsoft_calendar.configured
            ? { label: 'Not configured on server', color: 'gray' }
            : status.microsoft_calendar.connected
            ? { label: status.microsoft_calendar.account_email || 'Connected', color: 'green' }
            : { label: 'Not connected', color: 'amber' }
        }
        primaryAction={
          status.microsoft_calendar.configured && !status.microsoft_calendar.connected
            ? { label: busy === 'microsoft_calendar' ? 'Opening…' : 'Connect Outlook', onClick: () => handleConnect('microsoft_calendar'), disabled: busy === 'microsoft_calendar' || loading }
            : undefined
        }
        secondaryAction={
          status.microsoft_calendar.connected
            ? { label: busy === 'microsoft_calendar' ? 'Disconnecting…' : 'Disconnect', onClick: () => handleDisconnect('microsoft_calendar', 'Outlook') }
            : undefined
        }
        footnote={
          !status.microsoft_calendar.configured
            ? 'Admin: set MICROSOFT_OAUTH_CLIENT_ID / SECRET / REDIRECT_URL to enable.'
            : undefined
        }
      />

      {/* DocuSign — platform-wide service */}
      <IntegrationCard
        logo="📄"
        name="DocuSign"
        description="Send any deal document for signature directly from the Documents tab on a deal. Signed envelopes sync back automatically."
        statusBadge={
          status.docusign.configured
            ? { label: 'Enabled platform-wide', color: 'green' }
            : { label: 'Not configured on server', color: 'gray' }
        }
        footnote={
          status.docusign.configured
            ? 'Open any deal → Documents tab → "Send for signature" to use DocuSign.'
            : 'Admin: set DOCUSIGN_INTEGRATION_KEY / USER_ID / ACCOUNT_ID / PRIVATE_KEY.'
        }
      />

      {/* Stripe — platform-wide payments */}
      <IntegrationCard
        logo="💳"
        name="Stripe Payments"
        description="Fast Pass enrollment fees, Smooth Exit fees, and the $75 closing fee are processed through Stripe Checkout."
        statusBadge={
          status.stripe.configured
            ? { label: 'Enabled platform-wide', color: 'green' }
            : { label: 'Not configured on server', color: 'gray' }
        }
        footnote={
          status.stripe.configured
            ? 'Buyers see a Stripe Checkout link in their Fast Pass / Smooth Exit flow.'
            : 'Admin: set STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET.'
        }
      />

      {/* ARIVE — per-deal, Mountain Mortgage scope */}
      <IntegrationCard
        logo="🏔️"
        name="ARIVE (Mountain Mortgage)"
        description="Real-time loan milestone sync for Mountain Mortgage / Fast Pass buyers. Disclosures, underwriting status, and clear-to-close update automatically once a loan ID is linked to the deal."
        statusBadge={
          status.arive.configured
            ? { label: 'Enabled platform-wide', color: 'green' }
            : { label: 'Not configured on server', color: 'gray' }
        }
        footnote={
          status.arive.configured
            ? 'Link a buyer\'s ARIVE loan from the deal\'s Overview tab. Fast Pass enrollments auto-link.'
            : 'Admin: set ARIVE_API_URL / ARIVE_API_KEY / ARIVE_CLIENT_ID / ARIVE_CLIENT_SECRET.'
        }
      />
    </div>
  );
}

// ─── Transaction Coordinator Section (agents only) ───────────────────────────

function TransactionCoordinatorSection({ agentId: _agentId }: { agentId: string }) {
  const { tc: existing, saveTC, removeTC } = useTC();

  const [form, setForm] = useState({ name: '', email: '', phone: '' });
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);

  // React 19 pattern: hydrate local form state from fetched record by
  // comparing to previous value during render.
  const [prevExisting, setPrevExisting] = useState(existing);
  if (existing !== prevExisting) {
    setPrevExisting(existing);
    if (existing) setForm({ name: existing.name, email: existing.email, phone: existing.phone });
  }

  const canSave = form.name.trim().length > 0 && form.email.trim().length > 0;

  async function handleSave() {
    if (!canSave || saving) return;
    setSaving(true);
    try {
      await saveTC(form.name, form.email, form.phone);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch {}
    setSaving(false);
  }

  async function handleClear() {
    await removeTC().catch(() => {});
    setForm({ name: '', email: '', phone: '' });
    setConfirmClear(false);
  }

  return (
    <div className="space-y-5 max-w-lg">
      {/* Explainer */}
      <div className="rounded-2xl bg-blue-50 border border-blue-100 px-5 py-4">
        <div className="flex items-start gap-3">
          <UserCheck size={18} className="text-blue-500 mt-0.5 flex-shrink-0" />
          <div>
            <p className="text-sm font-semibold text-blue-800">Your dedicated Transaction Coordinator</p>
            <p className="text-xs text-blue-600 mt-1 leading-relaxed">
              Your TC is automatically added to every deal you work. They get access to the file, the internal message thread, checklists, and tasks. Only you can assign your TC — update this anytime if your coordinator changes.
            </p>
          </div>
        </div>
      </div>

      {/* Current TC card */}
      {existing && (
        <div className="rounded-2xl bg-white shadow-sm overflow-hidden">
          <div className="px-5 py-3 border-b border-gray-50">
            <span className="text-xs font-bold uppercase tracking-wider text-gray-400">Current TC</span>
          </div>
          <div className="flex items-center gap-4 px-5 py-4">
            <div className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-xl bg-amber-100 text-amber-700 font-bold text-lg">
              {existing.name.charAt(0)}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="font-bold text-brand-navy">{existing.name}</span>
                {existing.userId && (
                  <span className="rounded-full bg-green-100 px-2 py-0.5 text-[10px] font-bold text-green-700">
                    In RealTourFlow
                  </span>
                )}
              </div>
              <div className="flex items-center gap-3 mt-1">
                <span className="flex items-center gap-1 text-xs text-gray-400">
                  <Mail size={11} /> {existing.email}
                </span>
                {existing.phone && (
                  <span className="flex items-center gap-1 text-xs text-gray-400">
                    <Phone size={11} /> {existing.phone}
                  </span>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Edit form */}
      <div className="rounded-2xl bg-white shadow-sm divide-y divide-gray-50 overflow-hidden">
        <div className="px-5 py-3 border-b border-gray-50">
          <span className="text-xs font-bold uppercase tracking-wider text-gray-400">
            {existing ? 'Update TC info' : 'Add your TC'}
          </span>
        </div>
        {[
          { label: 'Full name',     key: 'name',  placeholder: 'e.g. Jamie Taylor',          required: true },
          { label: 'Email',         key: 'email', placeholder: 'jamie@youroffice.com',        required: true },
          { label: 'Phone',         key: 'phone', placeholder: '(205) 555-0100',              required: false },
        ].map(({ label, key, placeholder, required }) => (
          <div key={key} className="flex items-center gap-4 px-5 py-3.5">
            <label className="w-24 flex-shrink-0 text-xs font-semibold text-gray-400 uppercase tracking-wide">
              {label}{required && <span className="text-red-400 ml-0.5">*</span>}
            </label>
            <input
              type={key === 'email' ? 'email' : 'text'}
              value={form[key as keyof typeof form] ?? ''}
              onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))}
              placeholder={placeholder}
              className="flex-1 rounded-lg border border-transparent bg-gray-50 px-3 py-1.5 text-sm text-gray-800 outline-none focus:border-brand-navy/20 focus:bg-white focus:ring-2 focus:ring-brand-navy/10 transition-all"
            />
          </div>
        ))}
      </div>

      <p className="text-xs text-gray-300">
        If your TC doesn&apos;t have a RealTourFlow account yet, you can still enter their info. They&apos;ll be invited to join when you save.
      </p>

      <div className="flex items-center gap-3">
        <button
          onClick={handleSave}
          disabled={!canSave}
          className={[
            'flex items-center gap-2 rounded-xl px-5 py-2.5 text-sm font-bold transition-all',
            saved
              ? 'bg-green-500 text-white'
              : canSave
              ? 'bg-brand-navy text-white hover:bg-brand-navy/90 active:scale-[0.98]'
              : 'bg-gray-100 text-gray-300 cursor-not-allowed',
          ].join(' ')}
        >
          {saved ? <><Check size={15} /> Saved</> : saving ? 'Saving…' : existing ? 'Update TC' : 'Save TC'}
        </button>

        {existing && !confirmClear && (
          <button
            onClick={() => setConfirmClear(true)}
            className="rounded-xl border border-gray-200 px-4 py-2.5 text-sm font-semibold text-gray-400 hover:border-red-200 hover:text-red-400 transition-colors"
          >
            Remove TC
          </button>
        )}
        {confirmClear && (
          <div className="flex items-center gap-2">
            <span className="text-xs text-gray-400">Remove {existing?.name}?</span>
            <button onClick={handleClear} className="rounded-lg bg-red-500 px-3 py-1.5 text-xs font-bold text-white hover:bg-red-600">
              Yes, remove
            </button>
            <button onClick={() => setConfirmClear(false)} className="text-xs text-gray-400 hover:text-gray-600">
              Cancel
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── My Agents Section (TC only) ─────────────────────────────────────────────

function MyAgentsSection({ tcUserId: _tcUserId }: { tcUserId: string }) {
  const { agents: myAgents, loading } = useMyAgents();

  return (
    <div className="space-y-5 max-w-lg">
      {/* Explainer */}
      <div className="rounded-2xl bg-amber-50 border border-amber-100 px-5 py-4">
        <div className="flex items-start gap-3">
          <Users size={18} className="text-amber-600 mt-0.5 flex-shrink-0" />
          <div>
            <p className="text-sm font-semibold text-amber-800">Agents you work with</p>
            <p className="text-xs text-amber-700 mt-1 leading-relaxed">
              These agents have added you as their Transaction Coordinator. You&apos;re automatically included in their deals, internal messages, and checklists. Agents manage this relationship from their own settings.
            </p>
          </div>
        </div>
      </div>

      {loading ? (
        <div className="rounded-2xl bg-white shadow-sm px-5 py-6 text-center">
          <p className="text-sm text-gray-300">Loading…</p>
        </div>
      ) : myAgents.length === 0 ? (
        <div className="rounded-2xl bg-white shadow-sm px-5 py-10 text-center">
          <Users size={28} className="mx-auto mb-2 text-gray-200" />
          <p className="text-sm text-gray-400">No agents linked yet</p>
          <p className="text-xs text-gray-300 mt-1">Agents add you from their Settings → Transaction Coordinator tab</p>
        </div>
      ) : (
        <div className="rounded-2xl bg-white shadow-sm overflow-hidden divide-y divide-gray-50">
          {myAgents.map((agent) => (
            <div key={agent.id} className="flex items-center gap-4 px-5 py-4">
              <div className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-xl bg-brand-navy/10 text-brand-navy font-bold text-sm">
                {agent.name.split(' ').map((p) => p[0]).join('').slice(0, 2).toUpperCase()}
              </div>
              <div className="flex-1 min-w-0">
                <span className="font-bold text-brand-navy">{agent.name}</span>
                <div className="flex items-center gap-3 mt-0.5 flex-wrap">
                  <a
                    href={`mailto:${agent.email}`}
                    className="flex items-center gap-1 text-xs text-gray-400 hover:text-brand-navy transition-colors"
                  >
                    <Mail size={11} /> {agent.email}
                  </a>
                  {agent.phone && (
                    <a
                      href={`tel:${agent.phone}`}
                      className="flex items-center gap-1 text-xs text-gray-400 hover:text-brand-navy transition-colors"
                    >
                      <Phone size={11} /> {agent.phone}
                    </a>
                  )}
                </div>
              </div>
              <div className="flex-shrink-0 text-right">
                <div className="flex items-center gap-1.5 justify-end">
                  <FileText size={13} className="text-gray-300" />
                  <span className="text-sm font-bold text-brand-navy">{agent.activeDealCount}</span>
                </div>
                <div className="text-[10px] text-gray-300 mt-0.5">active deals</div>
              </div>
            </div>
          ))}
        </div>
      )}

      {!loading && (
        <p className="text-xs text-gray-300">
          {myAgents.length} agent{myAgents.length !== 1 ? 's' : ''} · You appear in {myAgents.reduce((sum, a) => sum + a.activeDealCount, 0)} active deal files
        </p>
      )}
    </div>
  );
}

// ─── Documents Section ────────────────────────────────────────────────────────

const ALL_DOC_TYPES: DocType[] = ['baa', 'listing_agreement', 'purchase_contract', 'disclosure', 'other'];

function DocumentsSection({ agentId: _agentId }: { agentId: string }) {
  const { docs, loading, uploadDoc, updateDoc, removeDoc, getDownloadUrl } = useAgentDocs();
  const [showAddForm, setShowAddForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formDocType, setFormDocType] = useState<DocType>('baa');
  const [formName, setFormName]       = useState('');
  const [formNotes, setFormNotes]     = useState('');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadErr, setUploadErr] = useState('');

  async function handleAdd() {
    if (!selectedFile || uploading) return;
    // Reject obviously bad files early.
    const ALLOWED = ['.pdf', '.doc', '.docx'];
    const ext = selectedFile.name.toLowerCase().slice(selectedFile.name.lastIndexOf('.'));
    if (!ALLOWED.includes(ext)) {
      setUploadErr(`Unsupported file type "${ext}". Use PDF, DOC, or DOCX.`);
      return;
    }
    if (selectedFile.size > 25 * 1024 * 1024) {
      setUploadErr('File is too large — max 25 MB.');
      return;
    }
    setUploading(true);
    setUploadErr('');
    try {
      await uploadDoc(selectedFile, formDocType, formName, formNotes);
      setShowAddForm(false);
      setFormName(''); setFormNotes(''); setFormDocType('baa'); setSelectedFile(null);
    } catch (e) {
      setUploadErr(e instanceof Error ? `Upload failed — ${e.message}` : 'Upload failed — please try again.');
    }
    setUploading(false);
  }

  async function handleSaveEdit(doc: AgentDocTemplate) {
    await updateDoc(doc.id, {
      name: formName.trim() || undefined,
      notes: formNotes.trim() || null,
    }).catch(() => {});
    setEditingId(null);
  }

  async function handleDownload(id: string) {
    try {
      const url = await getDownloadUrl(id);
      window.open(url, '_blank');
    } catch {}
  }

  const DOC_TYPE_ICON_COLOR: Record<DocType, string> = {
    baa:               'bg-blue-100 text-blue-600',
    listing_agreement: 'bg-purple-100 text-purple-600',
    purchase_contract: 'bg-green-100 text-green-600',
    disclosure:        'bg-amber-100 text-amber-600',
    other:             'bg-gray-100 text-gray-500',
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-bold text-brand-navy">Document Templates</h2>
          <p className="text-xs text-gray-400 mt-0.5">Templates sent to clients at the right stage of their deal</p>
        </div>
        <button
          onClick={() => setShowAddForm(true)}
          className="flex items-center gap-1.5 rounded-lg bg-brand-navy px-3 py-2 text-xs font-bold text-white hover:bg-brand-navy/90 transition-colors"
        >
          <Plus size={13} /> Add template
        </button>
      </div>

      {/* Add form */}
      {showAddForm && (
        <div className="rounded-xl border border-brand-navy/20 bg-brand-navy/5 p-4 space-y-3">
          <p className="text-xs font-bold text-brand-navy uppercase tracking-wide">New Template</p>
          <div>
            <label className="block text-[10px] font-bold text-gray-500 uppercase tracking-wide mb-1">Document Type</label>
            <select value={formDocType} onChange={(e) => setFormDocType(e.target.value as DocType)}
              className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm outline-none text-brand-navy">
              {ALL_DOC_TYPES.map((t) => <option key={t} value={t}>{DOC_TYPE_LABELS[t]}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-[10px] font-bold text-gray-500 uppercase tracking-wide mb-1">Display Name (optional)</label>
            <input value={formName} onChange={(e) => setFormName(e.target.value)}
              placeholder={DOC_TYPE_LABELS[formDocType]}
              className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm outline-none text-brand-navy placeholder:text-gray-300" />
          </div>
          <div>
            <label className="block text-[10px] font-bold text-gray-500 uppercase tracking-wide mb-1">Notes (optional)</label>
            <input value={formNotes} onChange={(e) => setFormNotes(e.target.value)}
              placeholder="e.g. Valid 90 days from signing"
              className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm outline-none text-brand-navy placeholder:text-gray-300" />
          </div>
          <div>
            <label className="block text-[10px] font-bold text-gray-500 uppercase tracking-wide mb-1">File <span className="text-red-400">*</span></label>
            <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-dashed border-gray-300 bg-white px-3 py-2.5 text-sm text-gray-500 hover:border-brand-navy/30 hover:bg-gray-50 transition-colors">
              <Upload size={14} className="text-gray-400" />
              {selectedFile ? selectedFile.name : 'Choose file…'}
              <input type="file" className="hidden"
                accept=".pdf,.doc,.docx"
                onChange={(e) => setSelectedFile(e.target.files?.[0] ?? null)} />
            </label>
          </div>
          {uploadErr && <p className="text-xs text-red-500">{uploadErr}</p>}
          <div className="flex items-center gap-2 pt-1">
            <button
              onClick={handleAdd}
              disabled={!selectedFile || uploading}
              className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-brand-navy py-2 text-sm font-bold text-white hover:bg-brand-navy/90 transition-colors disabled:opacity-40">
              <Upload size={13} /> {uploading ? 'Uploading…' : 'Upload template'}
            </button>
            <button onClick={() => { setShowAddForm(false); setFormName(''); setFormNotes(''); setSelectedFile(null); setUploadErr(''); }}
              className="rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-500 hover:bg-gray-50 transition-colors">
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Template list */}
      {loading ? (
        <div className="rounded-xl border border-dashed border-gray-200 px-5 py-6 text-center">
          <p className="text-sm text-gray-300">Loading…</p>
        </div>
      ) : docs.length === 0 && !showAddForm ? (
        <div className="rounded-xl border border-dashed border-gray-200 px-5 py-10 text-center">
          <FileText size={28} className="mx-auto mb-2 text-gray-200" />
          <p className="text-sm font-semibold text-gray-400">No templates yet</p>
          <p className="mt-1 text-xs text-gray-300">Add your buyer agency agreement, listing agreement, and more.</p>
        </div>
      ) : null}

      <div className="space-y-2">
        {docs.map((doc) => {
          const isEditing = editingId === doc.id;
          return (
            <div key={doc.id} className="rounded-xl border border-gray-200 bg-white overflow-hidden">
              <div className="flex items-start gap-3 p-4">
                <div className={`flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg ${DOC_TYPE_ICON_COLOR[doc.docType]}`}>
                  <FileText size={16} />
                </div>
                <div className="flex-1 min-w-0">
                  {isEditing ? (
                    <div className="space-y-2">
                      <input value={formName} onChange={(e) => setFormName(e.target.value)}
                        className="w-full rounded-lg border border-gray-200 px-2.5 py-1.5 text-sm outline-none text-brand-navy" />
                      <input value={formNotes} onChange={(e) => setFormNotes(e.target.value)}
                        placeholder="Notes (optional)"
                        className="w-full rounded-lg border border-gray-200 px-2.5 py-1.5 text-xs outline-none text-gray-600 placeholder:text-gray-300" />
                      <div className="flex gap-2">
                        <button onClick={() => handleSaveEdit(doc)}
                          className="rounded-lg bg-brand-navy px-3 py-1.5 text-xs font-bold text-white hover:bg-brand-navy/90 transition-colors">Save</button>
                        <button onClick={() => setEditingId(null)}
                          className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs text-gray-500 hover:bg-gray-50 transition-colors">Cancel</button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <p className="text-sm font-semibold text-brand-navy">{doc.name}</p>
                      <button
                        onClick={() => handleDownload(doc.id)}
                        className="flex items-center gap-1 text-xs text-brand-navy/60 hover:text-brand-navy transition-colors mt-0.5 truncate max-w-full"
                      >
                        <ExternalLink size={10} className="flex-shrink-0" /> {doc.fileName}
                      </button>
                      {doc.notes && <p className="text-xs text-gray-400 italic mt-0.5">{doc.notes}</p>}
                      <p className="text-[10px] text-gray-300 mt-1">
                        Added {new Date(doc.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                      </p>
                    </>
                  )}
                </div>
                {!isEditing && (
                  <div className="flex-shrink-0 flex gap-1.5">
                    <button onClick={() => { setEditingId(doc.id); setFormName(doc.name); setFormNotes(doc.notes ?? ''); }}
                      className="text-gray-400 hover:text-brand-navy transition-colors p-1">
                      <Pencil size={13} />
                    </button>
                    <button onClick={() => removeDoc(doc.id)}
                      className="text-gray-300 hover:text-red-400 transition-colors p-1">
                      <Trash2 size={13} />
                    </button>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Main ─────────────────────────────────────────────────────────────────────

export default function SettingsPage() {
  const { activeUser } = useAuthStore();
  const role = activeUser?.groupId ?? 'agent';
  const isAgent = role === 'agent' || role === 'admin';
  const isTC    = role === 'tc';

  const TABS: { id: Tab; label: string; icon: React.ReactNode }[] = [
    { id: 'profile',   label: 'Profile',                  icon: <User size={15} /> },
    ...(isAgent ? [{ id: 'tc' as Tab,        label: 'Transaction Coordinator', icon: <UserCheck size={15} /> }] : []),
    ...(isAgent ? [{ id: 'vendors' as Tab,   label: 'My Vendors',             icon: <Store size={15} /> }] : []),
    ...(isAgent ? [{ id: 'documents' as Tab, label: 'Documents',              icon: <FileText size={15} /> }] : []),
    ...(isTC    ? [{ id: 'my_agents' as Tab, label: 'My Agents',              icon: <Users size={15} /> }] : []),
    { id: 'notifications', label: 'Notifications', icon: <Bell size={15} /> },
    { id: 'integrations',  label: 'Integrations',  icon: <Plug size={15} /> },
  ];

  // Open the Integrations tab when an OAuth connect bounces back here, so its
  // return-flow handler (status refresh / error toast) runs.
  const [tab, setTab] = useState<Tab>(() =>
    settingsTabFromSearch(typeof window !== 'undefined' ? window.location.search : '')
  );
  const agentId = activeUser?.id ?? 'agent-sarah';

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-brand-navy">Settings</h1>
        <p className="text-sm text-gray-400 mt-0.5">Manage your profile, vendors, and integrations</p>
      </div>

      {/* Tab bar */}
      <div className="flex gap-1 overflow-x-auto border-b border-gray-100 pb-px">
        {TABS.map(({ id, label, icon }) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={[
              'flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-t-lg px-4 py-2.5 text-sm font-semibold transition-colors',
              tab === id
                ? 'border-b-2 border-brand-navy text-brand-navy'
                : 'text-gray-400 hover:text-gray-600',
            ].join(' ')}
          >
            {icon}
            {label}
          </button>
        ))}
      </div>

      {/* Section content */}
      {tab === 'profile'        && <ProfileSection />}
      {tab === 'tc'             && <TransactionCoordinatorSection agentId={agentId} />}
      {tab === 'vendors'        && <VendorsSection agentId={agentId} />}
      {tab === 'documents'      && <DocumentsSection agentId={agentId} />}
      {tab === 'my_agents'      && <MyAgentsSection tcUserId={activeUser?.id ?? 'tc-taylor'} />}
      {tab === 'notifications'  && <NotificationsSection />}
      {tab === 'integrations'   && <IntegrationsSection />}
    </div>
  );
}
