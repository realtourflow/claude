"use client";

import { useState } from "react";
import { Deal } from "@/lib/types";
import { useVendors } from "@/hooks/useVendors";
import { VENDOR_CATEGORY_LABELS, VENDOR_CATEGORY_ORDER, VendorCategory } from "@/lib/vendor-categories";
import { ChevronRight, ChevronDown, Phone, Mail, RefreshCw, Pencil, Plus, X, Star, Users, ExternalLink } from "lucide-react";

type ContactRole = 'lender' | 'titleCompany' | 'closingAttorney' | 'inspector' | 'insurance' | 'other';

const CONTACT_ROLE_LABELS: Record<ContactRole, string> = {
  lender: 'Lender',
  titleCompany: 'Title Company',
  closingAttorney: 'Closing Attorney',
  inspector: 'Home Inspector',
  insurance: 'Homeowners Insurance',
  other: 'Other',
};

type ContactForm = {
  role: ContactRole;
  company: string;
  contactName: string;
  phone: string;
  email: string;
  portalUrl: string;
};

const EMPTY_FORM: ContactForm = {
  role: 'lender',
  company: '',
  contactName: '',
  phone: '',
  email: '',
  portalUrl: '',
};

function AddContactModal({
  initial,
  onSave,
  onClose,
}: {
  initial?: Partial<ContactForm>;
  onSave: (data: ContactForm) => void;
  onClose: () => void;
}) {
  const [form, setForm] = useState<ContactForm>({ ...EMPTY_FORM, ...initial });

  function field(label: string, key: keyof ContactForm, type = 'text', placeholder = '') {
    return (
      <div>
        <label className="block text-xs font-semibold text-gray-500 mb-1">{label}</label>
        <input
          type={type}
          value={form[key] as string}
          onChange={(e) => setForm((p) => ({ ...p, [key]: e.target.value }))}
          placeholder={placeholder}
          className="w-full rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-brand-navy outline-none focus:border-brand-navy/30 focus:ring-2 focus:ring-brand-navy/10"
        />
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
      <div className="w-full max-w-md rounded-2xl bg-white shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b">
          <h2 className="font-bold text-brand-navy">Add Transaction Contact</h2>
          <button onClick={onClose} className="rounded-lg p-1.5 hover:bg-gray-100 transition-colors">
            <X size={16} className="text-gray-500" />
          </button>
        </div>

        {/* Form */}
        <div className="p-5 space-y-3">
          {/* Role picker */}
          <div>
            <label className="block text-xs font-semibold text-gray-500 mb-1">Role</label>
            <div className="grid grid-cols-2 gap-2">
              {(Object.keys(CONTACT_ROLE_LABELS) as ContactRole[]).map((r) => (
                <button
                  key={r}
                  onClick={() => setForm((p) => ({ ...p, role: r }))}
                  className={`rounded-lg border py-2 text-xs font-semibold transition-colors ${
                    form.role === r
                      ? 'border-brand-navy bg-brand-navy text-white'
                      : 'border-gray-200 bg-white text-gray-600 hover:bg-gray-50'
                  }`}
                >
                  {CONTACT_ROLE_LABELS[r]}
                </button>
              ))}
            </div>
          </div>

          {field('Company / Organization', 'company', 'text', 'e.g. Alabama Title Group')}
          {field('Contact Name', 'contactName', 'text', 'e.g. Diane Foster')}
          {field('Phone', 'phone', 'tel', '(205) 555-0000')}
          {field('Email', 'email', 'email', 'name@company.com')}
          {field('Portal URL (optional)', 'portalUrl', 'url', 'https://')}
        </div>

        {/* Actions */}
        <div className="flex gap-2 px-5 pb-5">
          <button
            onClick={onClose}
            className="flex-1 rounded-xl border border-gray-200 py-2.5 text-sm font-semibold text-gray-600 hover:bg-gray-50 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={() => onSave(form)}
            disabled={!form.company.trim()}
            className="flex-1 rounded-xl bg-brand-navy py-2.5 text-sm font-bold text-white hover:bg-brand-navy/80 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Save Contact
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Transaction contact row ───────────────────────────────────────────────────

function ContactRow({
  role,
  name,
  subtitle,
  phone,
  email,
  portalUrl,
  badge,
  avatarLetter,
  avatarColor,
  onEdit,
}: {
  role: string;
  name: string;
  subtitle?: string;
  phone?: string;
  email?: string;
  portalUrl?: string;
  badge?: React.ReactNode;
  avatarLetter: string;
  avatarColor: string;
  onEdit?: () => void;
}) {
  return (
    <div className="flex items-start gap-3 px-5 py-4 border-b border-gray-50 last:border-0">
      <div className={`flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full text-white text-sm font-bold ${avatarColor}`}>
        {avatarLetter}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-semibold text-brand-navy">{name}</span>
          {badge}
        </div>
        <p className="text-xs text-gray-400 mt-0.5">{role}{subtitle ? ` · ${subtitle}` : ''}</p>
        <div className="flex flex-wrap gap-1.5 mt-2">
          {phone && (
            <a href={`tel:${phone}`}
              className="flex items-center gap-1 rounded-lg bg-gray-50 border border-gray-100 px-2.5 py-1 text-xs font-medium text-gray-600 hover:bg-gray-100 transition-colors">
              <Phone size={10} /> {phone}
            </a>
          )}
          {email && (
            <a href={`mailto:${email}`}
              className="flex items-center gap-1 rounded-lg bg-gray-50 border border-gray-100 px-2.5 py-1 text-xs font-medium text-gray-600 hover:bg-gray-100 transition-colors">
              <Mail size={10} /> Email
            </a>
          )}
          {portalUrl && (
            <a href={portalUrl} target="_blank" rel="noopener noreferrer"
              className="flex items-center gap-1 rounded-lg bg-brand-navy/5 border border-brand-navy/10 px-2.5 py-1 text-xs font-semibold text-brand-navy hover:bg-brand-navy/10 transition-colors">
              <ExternalLink size={10} /> Portal
            </a>
          )}
        </div>
      </div>
      {onEdit && (
        <button onClick={onEdit}
          className="flex-shrink-0 rounded-lg p-1.5 hover:bg-gray-100 transition-colors mt-0.5">
          <Pencil size={13} className="text-gray-400" />
        </button>
      )}
    </div>
  );
}

// ── Preferred vendor category accordion ──────────────────────────────────────

function PreferredCategoryRow({ category, vendors }: { category: VendorCategory; vendors: ReturnType<typeof useVendors>['vendors'] }) {
  const [open, setOpen] = useState(false);
  if (vendors.length === 0) return null;

  return (
    <div className="border-b border-gray-50 last:border-0">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between px-5 py-3 hover:bg-gray-50 transition-colors"
      >
        <div className="flex items-center gap-2.5">
          <span className="text-sm font-medium text-brand-navy">
            {VENDOR_CATEGORY_LABELS[category]}
          </span>
          <span className="rounded-full bg-gray-100 px-1.5 py-0.5 text-[10px] font-bold text-gray-500">
            {vendors.length}
          </span>
        </div>
        {open ? <ChevronDown size={14} className="text-gray-400" /> : <ChevronRight size={14} className="text-gray-400" />}
      </button>

      {open && (
        <div className="px-5 pb-4 space-y-2">
          {vendors.map((v) => (
            <div key={v.id} className="rounded-xl border border-gray-100 bg-gray-50 p-3.5">
              <div className="flex items-start justify-between gap-2 mb-2">
                <div>
                  <div className="flex items-center gap-1.5">
                    {v.isFeatured && <Star size={11} className="text-brand-gold fill-brand-gold flex-shrink-0" />}
                    <span className="text-sm font-semibold text-brand-navy">{v.company}</span>
                  </div>
                  {v.contactName && <p className="text-xs text-gray-400 mt-0.5">{v.contactName}</p>}
                  {v.notes && <p className="text-xs text-gray-500 mt-1 italic leading-relaxed">&quot;{v.notes}&quot;</p>}
                </div>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {v.phone && (
                  <a href={`tel:${v.phone}`}
                    className="flex items-center gap-1 rounded-lg bg-white border border-gray-200 px-2.5 py-1 text-xs font-medium text-gray-600 hover:bg-gray-100 transition-colors">
                    <Phone size={10} /> {v.phone}
                  </a>
                )}
                {v.email && (
                  <a href={`mailto:${v.email}`}
                    className="flex items-center gap-1 rounded-lg bg-white border border-gray-200 px-2.5 py-1 text-xs font-medium text-gray-600 hover:bg-gray-100 transition-colors">
                    <Mail size={10} /> Email
                  </a>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Main VendorsTab ───────────────────────────────────────────────────────────

export function VendorsTab({ deal }: { deal: Deal }) {
  const [showModal, setShowModal] = useState(false);
  const [localVendors, setLocalVendors] = useState(deal.vendors ?? {});


  function handleSave(form: ContactForm) {
    if (form.role === 'other') {
      setShowModal(false);
      return;
    }
    const newContact = {
      company: form.company,
      contactName: form.contactName || undefined,
      phone: form.phone || undefined,
      email: form.email || undefined,
    };
    if (form.role === 'lender') {
      setLocalVendors((p) => ({
        ...p,
        lender: { ...newContact, isAriveIntegrated: false },
      }));
    } else {
      setLocalVendors((p) => ({ ...p, [form.role]: newContact }));
    }
    setShowModal(false);
  }

  const { vendors: preferredVendors } = useVendors();
  const availableCategories = VENDOR_CATEGORY_ORDER.filter((cat) =>
    preferredVendors.some((v) => v.category === cat)
  );

  return (
    <>
      {showModal && (
        <AddContactModal onSave={handleSave} onClose={() => setShowModal(false)} />
      )}

      <div className="space-y-4">

        {/* ── Section 1: Transaction Team ───────────────────────────────────── */}
        <div className="rounded-xl bg-white shadow-sm overflow-hidden">
          <div className="flex items-center justify-between px-5 py-3.5 border-b border-gray-100">
            <div className="flex items-center gap-2">
              <Users size={14} className="text-brand-navy" />
              <h3 className="text-xs font-bold uppercase tracking-widest text-gray-500">
                Transaction Team
              </h3>
            </div>
            <button
              onClick={() => setShowModal(true)}
              className="flex items-center gap-1 rounded-lg bg-brand-navy px-2.5 py-1.5 text-xs font-bold text-white hover:bg-brand-navy/80 transition-colors"
            >
              <Plus size={11} /> Add Contact
            </button>
          </div>

          {/* Agent — contact info comes from the real API on each deal */}
          {deal.agentName && (
            <ContactRow
              role="Agent"
              name={deal.agentName}
              subtitle={deal.agentEmail}
              phone={deal.agentPhone ?? undefined}
              email={deal.agentEmail}
              avatarLetter={deal.agentName.charAt(0)}
              avatarColor="bg-brand-navy"
            />
          )}

          {/* Lender */}
          {localVendors.lender ? (
            <ContactRow
              role="Lender"
              name={localVendors.lender.company}
              subtitle={localVendors.lender.loanOfficer ?? localVendors.lender.contactName}
              phone={localVendors.lender.phone}
              email={localVendors.lender.email}
              portalUrl={(localVendors.lender as { portalUrl?: string }).portalUrl}
              badge={
                localVendors.lender.isAriveIntegrated ? (
                  <span className="flex items-center gap-0.5 rounded-full bg-green-100 px-2 py-0.5 text-[10px] font-bold text-green-700">
                    <RefreshCw size={8} /> ARIVE
                  </span>
                ) : null
              }
              avatarLetter={localVendors.lender.company.charAt(0)}
              avatarColor="bg-blue-500"
              onEdit={() => setShowModal(true)}
            />
          ) : (
            <div className="px-5 py-3 border-b border-gray-50">
              <button
                onClick={() => setShowModal(true)}
                className="flex items-center gap-1.5 text-xs font-medium text-gray-400 hover:text-brand-navy transition-colors"
              >
                <Plus size={12} />
                {deal.type === 'buy' ? 'Add lender contact' : "Add buyer's lender"}
              </button>
            </div>
          )}

          {/* Title Company */}
          {localVendors.titleCompany ? (
            <ContactRow
              role="Title Company"
              name={localVendors.titleCompany.company}
              subtitle={localVendors.titleCompany.contactName}
              phone={localVendors.titleCompany.phone}
              email={localVendors.titleCompany.email}
              avatarLetter={localVendors.titleCompany.company.charAt(0)}
              avatarColor="bg-purple-500"
              onEdit={() => setShowModal(true)}
            />
          ) : (
            <div className="px-5 py-3 border-b border-gray-50">
              <button
                onClick={() => setShowModal(true)}
                className="flex items-center gap-1.5 text-xs font-medium text-gray-400 hover:text-brand-navy transition-colors"
              >
                <Plus size={12} /> Add title company
              </button>
            </div>
          )}

          {/* Closing Attorney */}
          {localVendors.closingAttorney ? (
            <ContactRow
              role="Closing Attorney"
              name={localVendors.closingAttorney.company}
              subtitle={localVendors.closingAttorney.contactName}
              phone={localVendors.closingAttorney.phone}
              email={localVendors.closingAttorney.email}
              avatarLetter={localVendors.closingAttorney.company.charAt(0)}
              avatarColor="bg-indigo-500"
              onEdit={() => setShowModal(true)}
            />
          ) : (
            <div className="px-5 py-3 border-b border-gray-50">
              <button
                onClick={() => setShowModal(true)}
                className="flex items-center gap-1.5 text-xs font-medium text-gray-400 hover:text-brand-navy transition-colors"
              >
                <Plus size={12} /> Add closing attorney
              </button>
            </div>
          )}

          {/* Inspector */}
          {localVendors.inspector ? (
            <ContactRow
              role="Home Inspector"
              name={localVendors.inspector.company}
              subtitle={localVendors.inspector.contactName}
              phone={localVendors.inspector.phone}
              email={localVendors.inspector.email}
              avatarLetter={localVendors.inspector.company.charAt(0)}
              avatarColor="bg-orange-400"
              onEdit={() => setShowModal(true)}
            />
          ) : (
            <div className="px-5 py-3 border-b border-gray-50">
              <button
                onClick={() => setShowModal(true)}
                className="flex items-center gap-1.5 text-xs font-medium text-gray-400 hover:text-brand-navy transition-colors"
              >
                <Plus size={12} /> Add inspector
              </button>
            </div>
          )}

          {/* Homeowners Insurance */}
          {localVendors.insurance ? (
            <ContactRow
              role="Homeowners Insurance"
              name={localVendors.insurance.company}
              subtitle={localVendors.insurance.contactName}
              phone={localVendors.insurance.phone}
              email={localVendors.insurance.email}
              avatarLetter={localVendors.insurance.company.charAt(0)}
              avatarColor="bg-teal-500"
              onEdit={() => setShowModal(true)}
            />
          ) : (
            <div className="px-5 py-3">
              <button
                onClick={() => setShowModal(true)}
                className="flex items-center gap-1.5 text-xs font-medium text-gray-400 hover:text-brand-navy transition-colors"
              >
                <Plus size={12} /> Add insurance contact
              </button>
            </div>
          )}
        </div>

        {/* ── Section 2: Preferred Vendor Directory ─────────────────────────── */}
        {availableCategories.length > 0 && (
          <div className="rounded-xl bg-white shadow-sm overflow-hidden">
            <div className="flex items-center gap-2 px-5 py-3.5 border-b border-gray-100">
              <Star size={14} className="text-brand-gold" />
              <h3 className="text-xs font-bold uppercase tracking-widest text-gray-500">
                Preferred Vendors
              </h3>
              <span className="ml-auto text-xs text-gray-400">
                {availableCategories.length} categories
              </span>
            </div>
            <p className="px-5 py-2.5 text-xs text-gray-400 bg-gray-50 border-b border-gray-100">
              Sarah&apos;s trusted vendor directory — shared with clients on their portal.
            </p>
            {availableCategories.map((cat) => (
              <PreferredCategoryRow key={cat} category={cat} vendors={preferredVendors.filter((v) => v.category === cat)} />
            ))}
          </div>
        )}

      </div>
    </>
  );
}

// ─── Timeline Tab ────────────────────────────────────────────────────────────
