"use client";

import { useState } from 'react';
import { X, UserPlus, Home, Mail, CheckCircle2, Send } from 'lucide-react';
import { sendDealInvite } from '@/hooks/useInvites';

type Props = {
  dealId: string;
  onClose: () => void;
};

type InviteRole = 'buyer' | 'seller' | null;

export default function DealInviteModal({ dealId, onClose }: Props) {
  const [role, setRole] = useState<InviteRole>(null);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [err, setErr] = useState('');

  const canSend = Boolean(role) && name.trim() !== '' && email.trim() !== '';

  async function handleSend() {
    if (!role || !name.trim() || !email.trim()) {
      setErr('Pick a role and fill in both name and email.');
      return;
    }
    setSending(true);
    setErr('');
    try {
      await sendDealInvite(dealId, {
        email: email.trim(),
        name: name.trim(),
        role,
      });
      setSent(true);
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : 'Failed to send invite — please try again.');
    }
    setSending(false);
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
            <h2 className="text-lg font-bold text-brand-navy">Invite by Email</h2>
            <p className="text-xs text-gray-400 mt-0.5">Send your client a link to join this deal</p>
          </div>
          <button
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-full text-gray-400 hover:bg-gray-100 hover:text-gray-600 transition-colors"
          >
            <X size={16} />
          </button>
        </div>

        {/* Body */}
        {sent ? (
          <div className="px-6 py-8 text-center">
            <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-green-100">
              <CheckCircle2 size={26} className="text-green-500" />
            </div>
            <h3 className="text-base font-bold text-brand-navy">Invite sent</h3>
            <p className="mt-1 text-sm text-gray-500 leading-relaxed">
              Email is on its way to <span className="font-semibold text-brand-navy break-all">{email.trim()}</span>.
            </p>
          </div>
        ) : (
          <div className="px-6 py-5 space-y-4">
            {/* Role selection */}
            <div>
              <p className="mb-3 text-sm font-medium text-gray-600">Who are you inviting?</p>
              <div className="grid grid-cols-2 gap-3">
                <button
                  onClick={() => setRole('buyer')}
                  className={[
                    'flex flex-col items-center gap-2 rounded-xl border-2 px-4 py-4 text-sm font-semibold transition-all',
                    role === 'buyer'
                      ? 'border-green-400 bg-green-50 text-green-700'
                      : 'border-gray-200 text-gray-500 hover:border-green-200 hover:bg-green-50/50',
                  ].join(' ')}
                >
                  <Home size={22} className={role === 'buyer' ? 'text-green-500' : 'text-gray-400'} />
                  Buyer
                </button>
                <button
                  onClick={() => setRole('seller')}
                  className={[
                    'flex flex-col items-center gap-2 rounded-xl border-2 px-4 py-4 text-sm font-semibold transition-all',
                    role === 'seller'
                      ? 'border-purple-400 bg-purple-50 text-purple-700'
                      : 'border-gray-200 text-gray-500 hover:border-purple-200 hover:bg-purple-50/50',
                  ].join(' ')}
                >
                  <UserPlus size={22} className={role === 'seller' ? 'text-purple-500' : 'text-gray-400'} />
                  Seller
                </button>
              </div>
            </div>

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

            <p className="text-[11px] text-gray-400">
              We&apos;ll email a secure join link tied to this deal. When they accept, they&apos;ll see the deal, tasks, and messages in their portal.
            </p>
          </div>
        )}

        {/* Footer */}
        <div className="border-t px-6 py-3 flex justify-end gap-3">
          {sent ? (
            <button
              onClick={onClose}
              className="rounded-lg bg-brand-navy px-5 py-2 text-sm font-bold text-white hover:bg-brand-navy/90 transition-colors"
            >
              Done
            </button>
          ) : (
            <>
              <button
                onClick={onClose}
                className="rounded-lg px-4 py-2 text-sm font-medium text-gray-500 hover:bg-gray-100 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleSend}
                disabled={!canSend || sending}
                className="flex items-center justify-center gap-1.5 rounded-lg bg-brand-navy px-5 py-2 text-sm font-bold text-white hover:bg-brand-navy/90 disabled:opacity-40 transition-colors"
              >
                <Send size={13} /> {sending ? 'Sending…' : 'Send Invite'}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
