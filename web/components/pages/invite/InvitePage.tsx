"use client";

import { useEffect, useState } from 'react';
import { useParams } from "next/navigation";
import { useAuth0 } from '@auth0/auth0-react';
import { api } from '../../api/client';
import { Home, UserPlus, CheckCircle2, AlertCircle, Loader2 } from 'lucide-react';

type InviteDetails = {
  token: string;
  deal_id: string;
  email: string;
  name: string;
  role: 'buyer' | 'seller';
  agent_name: string;
  deal_title: string;
  expires_at: string;
  claimed: boolean;
};

export default function InvitePage() {
  const { token } = useParams<{ token: string }>();
  const { loginWithRedirect, isAuthenticated, isLoading: auth0Loading } = useAuth0();
  const [invite, setInvite] = useState<InviteDetails | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) { setError('Invalid invite link'); setLoading(false); return; }
    api.get<InviteDetails>(`/invites/${token}`)
      .then(setInvite)
      .catch(() => setError('Invite not found or has expired.'))
      .finally(() => setLoading(false));
  }, [token]);

  function accept() {
    if (!token || !invite) return;
    localStorage.setItem('pendingInvite', token);
    localStorage.setItem('pendingInviteEmail', invite.email);
    if (isAuthenticated) {
      // Already logged in — navigate to root to trigger claim in AuthSetup
      window.location.href = '/';
    } else {
      loginWithRedirect({ appState: { returnTo: '/' } });
    }
  }

  if (auth0Loading || loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-brand-bg">
        <Loader2 size={28} className="animate-spin text-brand-navy/40" />
      </div>
    );
  }

  if (error || !invite) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-brand-bg p-6">
        <div className="w-full max-w-sm rounded-2xl bg-white shadow-xl p-8 text-center">
          <AlertCircle size={40} className="mx-auto mb-4 text-red-400" />
          <h1 className="text-lg font-bold text-brand-navy mb-2">Invite not found</h1>
          <p className="text-sm text-gray-400">{error ?? 'This invite link is invalid or has expired.'}</p>
        </div>
      </div>
    );
  }

  if (invite.claimed) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-brand-bg p-6">
        <div className="w-full max-w-sm rounded-2xl bg-white shadow-xl p-8 text-center">
          <CheckCircle2 size={40} className="mx-auto mb-4 text-green-400" />
          <h1 className="text-lg font-bold text-brand-navy mb-2">Already accepted</h1>
          <p className="text-sm text-gray-400">This invite has already been claimed. Log in to access your deal.</p>
          <button
            onClick={() => loginWithRedirect({ appState: { returnTo: '/' } })}
            className="mt-5 w-full rounded-xl bg-brand-navy py-3 text-sm font-bold text-white hover:bg-brand-navy/90 transition-colors"
          >
            Log in
          </button>
        </div>
      </div>
    );
  }

  const RoleIcon = invite.role === 'buyer' ? Home : UserPlus;
  const roleColor = invite.role === 'buyer' ? 'bg-green-100 text-green-700' : 'bg-purple-100 text-purple-700';

  return (
    <div className="flex min-h-screen items-center justify-center bg-brand-bg p-6">
      <div className="w-full max-w-sm">
        {/* Logo */}
        <div className="mb-6 text-center">
          <span className="text-xl font-bold text-brand-navy tracking-tight">RealTour Flow</span>
        </div>

        <div className="rounded-2xl bg-white shadow-xl overflow-hidden">
          {/* Header */}
          <div className="bg-brand-navy px-6 py-6 text-center">
            <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-white/10">
              <RoleIcon size={26} className="text-white" />
            </div>
            <h1 className="text-lg font-bold text-white">You're invited!</h1>
            <p className="mt-1 text-sm text-white/60">to join a real estate transaction</p>
          </div>

          {/* Details */}
          <div className="px-6 py-5 space-y-4">
            <div className="rounded-xl bg-brand-bg px-4 py-3.5 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Deal</span>
                <span className="text-sm font-bold text-brand-navy">{invite.deal_title}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Agent</span>
                <span className="text-sm text-gray-700">{invite.agent_name}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Your role</span>
                <span className={`rounded-full px-2.5 py-0.5 text-xs font-bold capitalize ${roleColor}`}>
                  {invite.role}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-gray-400 uppercase tracking-wide">For</span>
                <span className="text-sm text-gray-700">{invite.email}</span>
              </div>
            </div>

            <p className="text-xs text-gray-400 text-center leading-relaxed">
              By accepting, you'll get access to your deal file, tasks, messages, and documents through the client portal.
            </p>

            <button
              onClick={accept}
              className="w-full rounded-xl bg-brand-navy py-3 text-sm font-bold text-white hover:bg-brand-navy/90 active:scale-[0.98] transition-all shadow-sm"
            >
              {isAuthenticated ? 'Accept invitation →' : 'Accept & create account →'}
            </button>

            <p className="text-[11px] text-gray-300 text-center">
              Expires {new Date(invite.expires_at).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
