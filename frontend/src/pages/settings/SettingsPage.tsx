import { useState } from 'react';
import {
  User, Store, Bell, Plug, Star, Pencil, Trash2,
  ChevronUp, ChevronDown, Plus, X, Check, ExternalLink,
  Phone, Mail, Globe, Users, UserCheck, FileText, Upload,
} from 'lucide-react';
import { useAuthStore } from '../../store/authStore';
import { useVendorStore } from '../../store/vendorStore';
import { useAgentTCStore, MOCK_AGENT_ROSTER, TCInfo } from '../../store/agentTCStore';
import { useAgentDocStore, DocType, DOC_TYPE_LABELS, AgentDocTemplate } from '../../store/agentDocStore';
import {
  PreferredVendor,
  VendorCategory,
  VENDOR_CATEGORY_LABELS,
  VENDOR_CATEGORY_ORDER,
} from '../../data/mockVendors';

// ─── Tabs ─────────────────────────────────────────────────────────────────────

type Tab = 'profile' | 'tc' | 'vendors' | 'my_agents' | 'notifications' | 'integrations' | 'documents';

// Tabs vary by role — built dynamically in the main component

// ─── Vendor Modal ─────────────────────────────────────────────────────────────

type VendorFormData = Omit<PreferredVendor, 'id'>;

const EMPTY_FORM = (agentId: string): VendorFormData => ({
  agentId,
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
  agentId,
  initial,
  onSave,
  onClose,
}: {
  agentId: string;
  initial?: PreferredVendor;
  onSave: (data: VendorFormData) => void;
  onClose: () => void;
}) {
  const [form, setForm] = useState<VendorFormData>(
    initial
      ? { ...initial }
      : EMPTY_FORM(agentId)
  );

  function set<K extends keyof VendorFormData>(k: K, v: VendorFormData[K]) {
    setForm((f) => ({ ...f, [k]: v }));
  }

  const isEdit = !!initial;
  const canSave = form.company.trim().length > 0;

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
        <div className="border-t px-5 py-4 flex gap-3 flex-shrink-0">
          <button
            onClick={onClose}
            className="flex-1 rounded-xl border border-gray-200 py-2.5 text-sm font-semibold text-gray-500 hover:bg-gray-50 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={() => canSave && onSave(form)}
            disabled={!canSave}
            className={[
              'flex-1 rounded-xl py-2.5 text-sm font-bold transition-all',
              canSave
                ? 'bg-brand-navy text-white hover:bg-brand-navy/90'
                : 'cursor-not-allowed bg-gray-100 text-gray-300',
            ].join(' ')}
          >
            {isEdit ? 'Save changes' : 'Add vendor'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Vendors Section ──────────────────────────────────────────────────────────

function VendorsSection({ agentId }: { agentId: string }) {
  const { vendors, addVendor, updateVendor, deleteVendor, moveVendor, toggleFeatured } =
    useVendorStore();

  const [modal, setModal] = useState<
    { mode: 'add'; category: VendorCategory } | { mode: 'edit'; vendor: PreferredVendor } | null
  >(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  const myVendors = vendors.filter((v) => v.agentId === agentId);

  function handleSave(data: VendorFormData) {
    if (modal?.mode === 'edit') {
      updateVendor(modal.vendor.id, data);
    } else {
      addVendor(data);
    }
    setModal(null);
  }

  return (
    <div className="space-y-1">
      <p className="mb-5 text-sm text-gray-400">
        These vendors appear in your clients' portals under "Preferred Vendors." Changes apply to all active deals.
      </p>

      {VENDOR_CATEGORY_ORDER.map((category) => {
        const catVendors = myVendors.filter((v) => v.category === category);

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
          agentId={agentId}
          initial={modal.mode === 'edit' ? modal.vendor : undefined}
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
  const [form, setForm] = useState({
    name: activeUser?.name ?? '',
    phone: '',
    title: activeUser?.role ?? '',
    licenseNumber: '',
    bio: '',
  });
  const [saved, setSaved] = useState(false);

  function handleSave() {
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  return (
    <div className="space-y-5 max-w-lg">
      {/* Avatar */}
      <div className="flex items-center gap-4">
        <img
          src={activeUser?.avatar}
          alt={activeUser?.name}
          className="h-16 w-16 rounded-2xl ring-2 ring-brand-navy/10 object-cover"
        />
        <div>
          <div className="text-sm font-bold text-brand-navy">{activeUser?.name}</div>
          <div className="text-xs text-gray-400">{activeUser?.email}</div>
          <div className="mt-1 rounded-full bg-brand-navy/5 px-2 py-0.5 text-xs font-semibold text-brand-navy inline-block">
            {activeUser?.role}
          </div>
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
        className={[
          'flex items-center gap-2 rounded-xl px-5 py-2.5 text-sm font-bold transition-all',
          saved
            ? 'bg-green-500 text-white'
            : 'bg-brand-navy text-white hover:bg-brand-navy/90 active:scale-[0.98]',
        ].join(' ')}
      >
        {saved ? <><Check size={15} /> Saved</> : 'Save profile'}
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

function NotificationsSection() {
  const [enabled, setEnabled] = useState<Record<string, boolean>>({
    deal_stage: true,
    new_task: true,
    overdue_task: true,
    fastpass_enroll: true,
    disclosure_reminder: true,
    new_message: false,
    email: true,
    push: false,
  });

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
                  onClick={() => setEnabled((s) => ({ ...s, [id]: !s[id] }))}
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

function IntegrationsSection() {
  const { activeUser } = useAuthStore();
  const isMountainMortgage = activeUser?.groupId === 'admin' || activeUser?.id === 'agent-sarah';

  const integrations = [
    {
      name: 'DocuSign',
      logo: '📄',
      description: 'Send, sign, and track documents directly from the deal file. Connect your DocuSign account to enable envelope sending from within RealTour Flow.',
      status: 'not_connected' as const,
      cta: 'Connect DocuSign',
      ctaStyle: 'primary',
    },
    {
      name: 'Google Calendar',
      logo: '📅',
      description: 'Sync closing dates, inspection appointments, and task deadlines to your Google Calendar automatically.',
      status: 'not_connected' as const,
      cta: 'Connect Google Calendar',
      ctaStyle: 'primary',
    },
    {
      name: 'Outlook / Office 365',
      logo: '📆',
      description: 'Sync deal milestones and appointments to your Outlook calendar.',
      status: 'not_connected' as const,
      cta: 'Connect Outlook',
      ctaStyle: 'secondary',
    },
    {
      name: 'ARIVE (Mountain Mortgage)',
      logo: '🏔️',
      description: 'Real-time loan milestone sync from Mountain Mortgage. Disclosures, underwriting status, and clear-to-close update automatically.',
      status: isMountainMortgage ? ('connected' as const) : ('not_connected' as const),
      cta: isMountainMortgage ? 'Connected' : 'Contact admin to enable',
      ctaStyle: isMountainMortgage ? 'connected' : 'disabled',
      connectedNote: 'Syncing live data for all Mountain Mortgage deals',
    },
  ];

  return (
    <div className="space-y-3 max-w-lg">
      {integrations.map(({ name, logo, description, status, cta, ctaStyle, connectedNote }) => (
        <div key={name} className="rounded-2xl bg-white shadow-sm overflow-hidden">
          <div className="flex items-start gap-4 p-5">
            <div className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-xl bg-gray-50 text-2xl">
              {logo}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="font-bold text-brand-navy text-sm">{name}</span>
                {status === 'connected' && (
                  <span className="flex items-center gap-1 rounded-full bg-green-100 px-2 py-0.5 text-[10px] font-bold text-green-700">
                    <Check size={9} strokeWidth={3} /> Connected
                  </span>
                )}
              </div>
              <p className="mt-1 text-xs text-gray-400 leading-relaxed">{description}</p>
              {connectedNote && status === 'connected' && (
                <p className="mt-1 text-xs text-green-600 font-medium">{connectedNote}</p>
              )}
            </div>
          </div>
          <div className="border-t border-gray-50 px-5 py-3 flex items-center justify-between">
            <button
              disabled={ctaStyle === 'connected' || ctaStyle === 'disabled'}
              className={[
                'flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors',
                ctaStyle === 'primary'
                  ? 'bg-brand-navy text-white hover:bg-brand-navy/90'
                  : ctaStyle === 'connected'
                  ? 'bg-green-50 text-green-700 cursor-default'
                  : ctaStyle === 'secondary'
                  ? 'border border-gray-200 text-gray-500 hover:bg-gray-50'
                  : 'bg-gray-100 text-gray-400 cursor-not-allowed',
              ].join(' ')}
            >
              {ctaStyle !== 'connected' && ctaStyle !== 'disabled' && <ExternalLink size={11} />}
              {cta}
            </button>
            {(ctaStyle === 'primary' || ctaStyle === 'secondary') && (
              <span className="text-xs text-gray-300">Coming in a future update</span>
            )}
          </div>
        </div>
      ))}

      {/* Stripe teaser */}
      <div className="rounded-2xl border-2 border-dashed border-gray-200 p-5">
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-xl bg-gray-50 text-2xl">
            💳
          </div>
          <div>
            <div className="text-sm font-bold text-gray-400">Stripe Payments</div>
            <div className="text-xs text-gray-300 mt-0.5">
              In-app Fast Pass payment, split payments, and seller concession tracking — coming in v2.
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Transaction Coordinator Section (agents only) ───────────────────────────

function TransactionCoordinatorSection({ agentId }: { agentId: string }) {
  const { agentTCMap, setTC, clearTC } = useAgentTCStore();
  const existing = agentTCMap[agentId] ?? null;

  const [form, setForm] = useState<TCInfo>({
    name:   existing?.name  ?? '',
    email:  existing?.email ?? '',
    phone:  existing?.phone ?? '',
  });
  const [saved, setSaved] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);

  const canSave = form.name.trim().length > 0 && form.email.trim().length > 0;

  function handleSave() {
    setTC(agentId, { ...form, userId: existing?.userId });
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  function handleClear() {
    clearTC(agentId);
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
              value={form[key as keyof TCInfo] ?? ''}
              onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))}
              placeholder={placeholder}
              className="flex-1 rounded-lg border border-transparent bg-gray-50 px-3 py-1.5 text-sm text-gray-800 outline-none focus:border-brand-navy/20 focus:bg-white focus:ring-2 focus:ring-brand-navy/10 transition-all"
            />
          </div>
        ))}
      </div>

      <p className="text-xs text-gray-300">
        If your TC doesn't have a RealTourFlow account yet, you can still enter their info. They'll be invited to join when you save.
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
          {saved ? <><Check size={15} /> Saved</> : existing ? 'Update TC' : 'Save TC'}
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

function MyAgentsSection({ tcUserId }: { tcUserId: string }) {
  const { agentTCMap } = useAgentTCStore();

  // Find all agents who have this TC assigned
  const myAgents = MOCK_AGENT_ROSTER.filter(
    (agent) => agentTCMap[agent.id]?.userId === tcUserId
  );

  return (
    <div className="space-y-5 max-w-lg">
      {/* Explainer */}
      <div className="rounded-2xl bg-amber-50 border border-amber-100 px-5 py-4">
        <div className="flex items-start gap-3">
          <Users size={18} className="text-amber-600 mt-0.5 flex-shrink-0" />
          <div>
            <p className="text-sm font-semibold text-amber-800">Agents you work with</p>
            <p className="text-xs text-amber-700 mt-1 leading-relaxed">
              These agents have added you as their Transaction Coordinator. You're automatically included in their deals, internal messages, and checklists. Agents manage this relationship from their own settings.
            </p>
          </div>
        </div>
      </div>

      {myAgents.length === 0 ? (
        <div className="rounded-2xl bg-white shadow-sm px-5 py-10 text-center">
          <Users size={28} className="mx-auto mb-2 text-gray-200" />
          <p className="text-sm text-gray-400">No agents linked yet</p>
          <p className="text-xs text-gray-300 mt-1">Agents add you from their Settings → Transaction Coordinator tab</p>
        </div>
      ) : (
        <div className="rounded-2xl bg-white shadow-sm overflow-hidden divide-y divide-gray-50">
          {myAgents.map((agent) => (
            <div key={agent.id} className="flex items-center gap-4 px-5 py-4">
              <img
                src={agent.avatar}
                alt={agent.name}
                className="h-11 w-11 rounded-xl object-cover flex-shrink-0 ring-2 ring-brand-navy/10"
              />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-bold text-brand-navy">{agent.name}</span>
                  {agent.licenseNumber && (
                    <span className="text-[10px] text-gray-300 font-mono">{agent.licenseNumber}</span>
                  )}
                </div>
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

      <p className="text-xs text-gray-300">
        {myAgents.length} agent{myAgents.length !== 1 ? 's' : ''} · You appear in {myAgents.reduce((sum, a) => sum + a.activeDealCount, 0)} active deal files
      </p>
    </div>
  );
}

// ─── Documents Section ────────────────────────────────────────────────────────

const ALL_DOC_TYPES: DocType[] = ['baa', 'listing_agreement', 'purchase_contract', 'disclosure', 'other'];

const DOC_TYPE_DESCRIPTIONS: Record<DocType, string> = {
  baa:               'Required before showing homes to buyers',
  listing_agreement: 'For seller clients',
  purchase_contract: 'Standard purchase agreement',
  disclosure:        'Property disclosure statement',
  other:             'Any other template document',
};

function DocumentsSection({ agentId }: { agentId: string }) {
  const { docsByAgent, addDoc, removeDoc, updateDoc } = useAgentDocStore();
  const docs = docsByAgent[agentId] ?? [];
  const [showAddForm, setShowAddForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formDocType, setFormDocType] = useState<DocType>('baa');
  const [formName, setFormName]       = useState('');
  const [formNotes, setFormNotes]     = useState('');

  function handleAdd() {
    const name = formName.trim() || DOC_TYPE_LABELS[formDocType];
    addDoc({
      id: `doc-${formDocType}-${Date.now()}`,
      agentId,
      name,
      docType: formDocType,
      fileName: `${name.replace(/ /g, '_')}_Template.pdf`,
      uploadedAt: new Date().toISOString(),
      notes: formNotes.trim() || undefined,
    });
    setShowAddForm(false);
    setFormName(''); setFormNotes(''); setFormDocType('baa');
  }

  function handleSaveEdit(doc: AgentDocTemplate) {
    updateDoc(doc.id, { name: formName.trim() || doc.name, notes: formNotes.trim() || undefined });
    setEditingId(null);
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
          <div className="flex items-center gap-2 pt-1">
            <button onClick={handleAdd}
              className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-brand-navy py-2 text-sm font-bold text-white hover:bg-brand-navy/90 transition-colors">
              <Upload size={13} /> Simulate upload
            </button>
            <button onClick={() => { setShowAddForm(false); setFormName(''); setFormNotes(''); }}
              className="rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-500 hover:bg-gray-50 transition-colors">
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Template list */}
      {docs.length === 0 && !showAddForm && (
        <div className="rounded-xl border border-dashed border-gray-200 px-5 py-10 text-center">
          <FileText size={28} className="mx-auto mb-2 text-gray-200" />
          <p className="text-sm font-semibold text-gray-400">No templates yet</p>
          <p className="mt-1 text-xs text-gray-300">Add your buyer agency agreement, listing agreement, and more.</p>
        </div>
      )}

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
                      <p className="text-xs text-gray-400 truncate">{doc.fileName}</p>
                      {doc.notes && <p className="text-xs text-gray-400 italic mt-0.5">{doc.notes}</p>}
                      <p className="text-[10px] text-gray-300 mt-1">
                        Added {new Date(doc.uploadedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
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

  const [tab, setTab] = useState<Tab>('profile');
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
              'flex items-center gap-1.5 whitespace-nowrap rounded-t-lg px-4 py-2.5 text-sm font-semibold transition-colors',
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
