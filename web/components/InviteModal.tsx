"use client";

import { useState } from 'react';
import { X, Copy, Check, UserPlus, Home, Mail, Send } from 'lucide-react';
import { sendClientInviteEmail } from '@/hooks/useInvites';

type Props = {
  agentId: string;
  onClose: () => void;
};

type InviteType = 'buyer' | 'seller' | null;

export default function InviteModal({ agentId, onClose }: Props) {
  const [selected, setSelected] = useState<InviteType>(null);
  const [copied, setCopied] = useState(false);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [sending, setSending] = useState(false);
  const [sentTo, setSentTo] = useState('');
  const [err, setErr] = useState('');

  const base = window.location.origin;
  const link = selected ? `${base}/onboard/${selected}?agent=${agentId}` : '';

  function handleCopy() {
    if (!link) return;
    navigator.clipboard.writeText(link).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  async function handleEmail() {
    if (!selected || !name.trim() || !email.trim()) {
      setErr('Fill in both name and email.');
      return;
    }
    setSending(true);
    setErr('');
    setSentTo('');
    try {
      await sendClientInviteEmail({
        email: email.trim(),
        name: name.trim(),
        role: selected,
      });
      setSentTo(email.trim());
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : 'Failed to send — please try again.');
    }
    setSending(false);
  }

  // Reset the email sub-form (incl. the success/error notice) when the role
  // changes, so a prior "Emailed to …" confirmation can't linger under a
  // different role's onboarding link.
  function pickRole(r: InviteType) {
    setSelected(r);
    setSentTo('');
    setErr('');
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
                onClick={() => pickRole('buyer')}
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
                onClick={() => pickRole('seller')}
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

              {/* Or email it to them */}
              <div className="space-y-3 border-t pt-4">
                <p className="text-sm font-medium text-gray-600">Or email it to them</p>

                {/* Name */}
                <div>
                  <label className="block text-[10px] font-bold text-gray-500 uppercase tracking-wide mb-1">
                    Name <span className="text-red-400">*</span>
                  </label>
                  <input
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="e.g. Jordan Smith"
                    className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm outline-none text-brand-navy placeholder:text-gray-300 focus:border-brand-navy/40 focus:ring-2 focus:ring-brand-navy/10"
                  />
                </div>

                {/* Email */}
                <div>
                  <label className="block text-[10px] font-bold text-gray-500 uppercase tracking-wide mb-1">
                    Email <span className="text-red-400">*</span>
                  </label>
                  <div className="flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2 focus-within:border-brand-navy/40 focus-within:ring-2 focus-within:ring-brand-navy/10">
                    <Mail size={14} className="text-gray-400 flex-shrink-0" />
                    <input
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="client@email.com"
                      className="flex-1 text-sm outline-none bg-transparent text-brand-navy placeholder:text-gray-300 min-w-0"
                    />
                  </div>
                </div>

                {err && <p className="text-xs text-red-500">{err}</p>}
                {sentTo && (
                  <p className="text-xs font-medium text-green-600">
                    Emailed to {sentTo} ✓
                  </p>
                )}

                <button
                  onClick={handleEmail}
                  disabled={sending || name.trim() === '' || email.trim() === ''}
                  className="flex w-full items-center justify-center gap-1.5 rounded-lg bg-brand-navy px-5 py-2 text-sm font-bold text-white hover:bg-brand-navy/90 disabled:opacity-40 transition-colors"
                >
                  <Send size={13} /> {sending ? 'Sending…' : 'Invite by email'}
                </button>
              </div>
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
