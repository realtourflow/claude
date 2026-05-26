"use client";

import { useState } from 'react';
import { Phone, Mail, Star, ChevronDown, ChevronRight, BookOpen } from 'lucide-react';
import {
  VENDOR_CATEGORY_LABELS,
  VENDOR_CATEGORY_ORDER,
  VendorCategory,
} from '../data/mockVendors';
import { useVendors, Vendor } from '../hooks/useVendors';

function CategorySection({ category, vendors }: { category: VendorCategory; vendors: Vendor[] }) {
  const [open, setOpen] = useState(false);
  if (vendors.length === 0) return null;

  const featured = vendors.find((v) => v.isFeatured);

  return (
    <div className="border-b border-gray-100 last:border-0">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between px-4 py-3 hover:bg-gray-50 transition-colors text-left"
      >
        <div className="flex items-center gap-2.5">
          <span className="text-sm font-semibold text-brand-navy">
            {VENDOR_CATEGORY_LABELS[category]}
          </span>
          <span className="rounded-full bg-gray-100 px-1.5 py-0.5 text-[10px] font-bold text-gray-500">
            {vendors.length}
          </span>
        </div>
        <div className="flex items-center gap-2">
          {featured && !open && (
            <span className="text-xs text-gray-400 truncate max-w-[120px]">{featured.company}</span>
          )}
          {open ? (
            <ChevronDown size={14} className="text-gray-400 flex-shrink-0" />
          ) : (
            <ChevronRight size={14} className="text-gray-400 flex-shrink-0" />
          )}
        </div>
      </button>

      {open && (
        <div className="px-4 pb-3 space-y-2.5">
          {vendors.map((vendor) => (
            <div key={vendor.id} className="rounded-xl border border-gray-100 bg-white p-3.5">
              <div className="flex items-start justify-between gap-2 mb-2">
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5">
                    {vendor.isFeatured && (
                      <Star size={11} className="text-brand-gold fill-brand-gold flex-shrink-0" />
                    )}
                    <p className="text-sm font-semibold text-brand-navy leading-tight">
                      {vendor.company}
                    </p>
                  </div>
                  {vendor.contactName && (
                    <p className="text-xs text-gray-400 mt-0.5">{vendor.contactName}</p>
                  )}
                  {vendor.notes && (
                    <p className="text-xs text-gray-500 mt-1 leading-relaxed italic">
                      "{vendor.notes}"
                    </p>
                  )}
                </div>
              </div>
              <div className="flex gap-2">
                {vendor.phone && (
                  <a
                    href={`tel:${vendor.phone}`}
                    className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-gray-50 border border-gray-100 py-1.5 text-xs font-semibold text-gray-600 hover:bg-gray-100 transition-colors"
                  >
                    <Phone size={11} /> {vendor.phone}
                  </a>
                )}
                {vendor.email && (
                  <a
                    href={`mailto:${vendor.email}`}
                    className="flex items-center justify-center gap-1.5 rounded-lg bg-gray-50 border border-gray-100 px-3 py-1.5 text-xs font-semibold text-gray-600 hover:bg-gray-100 transition-colors"
                  >
                    <Mail size={11} />
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

export default function VendorDirectory({ agentId: _agentId }: { agentId: string }) {
  const [open, setOpen] = useState(false);
  const { vendors, loading } = useVendors();

  const availableCategories = VENDOR_CATEGORY_ORDER.filter((cat) =>
    vendors.some((v) => v.category === cat)
  );

  if (!loading && availableCategories.length === 0) return null;

  return (
    <div className="rounded-2xl bg-white border border-gray-100 shadow-sm overflow-hidden">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between px-5 py-4 hover:bg-gray-50 transition-colors text-left"
      >
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl bg-brand-navy/5">
            <BookOpen size={16} className="text-brand-navy" />
          </div>
          <div>
            <p className="text-sm font-bold text-brand-navy">Agent's Preferred Vendors</p>
            <p className="text-xs text-gray-400">
              {availableCategories.length} categories · trusted &amp; recommended
            </p>
          </div>
        </div>
        {open ? (
          <ChevronDown size={16} className="text-gray-400 flex-shrink-0" />
        ) : (
          <ChevronRight size={16} className="text-gray-400 flex-shrink-0" />
        )}
      </button>

      {open && (
        <div className="border-t border-gray-100">
          <p className="px-4 py-2.5 text-xs text-gray-400 bg-gray-50">
            Need a plumber, inspector, or mover? These are your agent's go-to contacts.
          </p>
          {availableCategories.map((cat) => (
            <CategorySection
              key={cat}
              category={cat}
              vendors={vendors.filter((v) => v.category === cat)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
