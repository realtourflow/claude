"use client";

import { useState } from 'react';
import { X, Copy, Check, UserPlus, Home } from 'lucide-react';

type Props = {
  agentId: string;
  onClose: () => void;
};

type InviteType = 'buyer' | 'seller' | null;

export default function InviteModal({ agentId, onClose }: Props) {
  const [selected, setSelected] = useState<InviteType>(null);
  const [copied, setCopied] = useState(false);

  const base = window.location.origin;
  const link = selected ? `${base}/onboard/${selected}?agent=${agentId}` : '';

  function handleCopy() {
    if (!link) return;
    navigator.clipboard.writeText(link).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />

      {/* Modal */}
      <div className="relative w-full max-w-md rounded-2xl bg-white shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b px-6 py-4">
          <div>
            <h2 className="text-lg font-bold text-brand-navy">Invite Client</h2>
            <p className="text-xs text-gray-400 mt-0.5">Generate a link to send to your buyer or seller</p>
          </div>
          <button
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-full text-gray-400 hover:bg-gray-100 hover:text-gray-600 transition-colors"
          >
            <X size={16} />
          </button>
        </div>

        {/* Body */}
        <div className="px-6 py-5 space-y-4">
          {/* Type selection */}
          <div>
            <p className="mb-3 text-sm font-medium text-gray-600">Who are you inviting?</p>
            <div className="grid grid-cols-2 gap-3">
              <button
                onClick={() => setSelected('buyer')}
                className={[
                  'flex flex-col items-center gap-2 rounded-xl border-2 px-4 py-4 text-sm font-semibold transition-all',
                  selected === 'buyer'
                    ? 'border-green-400 bg-green-50 text-green-700'
                    : 'border-gray-200 text-gray-500 hover:border-green-200 hover:bg-green-50/50',
                ].join(' ')}
              >
                <Home size={22} className={selected === 'buyer' ? 'text-green-500' : 'text-gray-400'} />
                Buyer
                <span className="text-[11px] font-normal text-gray-400">Home search → pipeline</span>
              </button>
              <button
                onClick={() => setSelected('seller')}
                className={[
                  'flex flex-col items-center gap-2 rounded-xl border-2 px-4 py-4 text-sm font-semibold transition-all',
                  selected === 'seller'
                    ? 'border-purple-400 bg-purple-50 text-purple-700'
                    : 'border-gray-200 text-gray-500 hover:border-purple-200 hover:bg-purple-50/50',
                ].join(' ')}
              >
                <UserPlus size={22} className={selected === 'seller' ? 'text-purple-500' : 'text-gray-400'} />
                Seller
                <span className="text-[11px] font-normal text-gray-400">Listing intake → pipeline</span>
              </button>
            </div>
          </div>

          {/* Generated link */}
          {selected && (
            <div className="space-y-2">
              <p className="text-sm font-medium text-gray-600">Shareable link</p>
              <div className="flex items-center gap-2 rounded-xl border border-gray-200 bg-brand-bg px-3 py-2.5">
                <span className="flex-1 truncate font-mono text-xs text-gray-600">{link}</span>
                <button
                  onClick={handleCopy}
                  className={[
                    'flex flex-shrink-0 items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-all',
                    copied
                      ? 'bg-green-500 text-white'
                      : 'bg-brand-navy text-white hover:bg-brand-navy/80',
                  ].join(' ')}
                >
                  {copied ? <Check size={13} /> : <Copy size={13} />}
                  {copied ? 'Copied!' : 'Copy'}
                </button>
              </div>
              <p className="text-[11px] text-gray-400">
                This link is tied to your account. When your client completes onboarding they&apos;ll appear in your pipeline automatically.
              </p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="border-t px-6 py-3 flex justify-end">
          <button
            onClick={onClose}
            className="rounded-lg px-4 py-2 text-sm font-medium text-gray-500 hover:bg-gray-100 transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
