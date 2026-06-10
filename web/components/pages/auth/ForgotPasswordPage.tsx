"use client";

import { useState, FormEvent } from 'react';
import Link from "next/link";
import { KeyRound, CheckCircle2, Loader2, AlertCircle } from 'lucide-react';

type Status = 'idle' | 'submitting' | 'sent' | 'error';

/**
 * Public "Forgot password?" page (FF2 #20). Posts to the public
 * /api/auth/password-reset route, which triggers Auth0's hosted reset email.
 *
 * Uses raw fetch instead of lib/api-client on purpose: this page is pre-login,
 * and the api-client's tokenGetter (getAccessTokenSilently) rejects for
 * anonymous visitors before the request is even sent.
 */
export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [status, setStatus] = useState<Status>('idle');
  const [errorMsg, setErrorMsg] = useState('');

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (status === 'submitting') return;
    setStatus('submitting');
    setErrorMsg('');
    try {
      const res = await fetch('/api/auth/password-reset', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim() }),
      });
      if (res.ok) {
        setStatus('sent');
      } else if (res.status === 400) {
        setStatus('error');
        setErrorMsg('Please enter a valid email address.');
      } else {
        setStatus('error');
        setErrorMsg('Something went wrong on our end. Please try again.');
      }
    } catch {
      setStatus('error');
      setErrorMsg('Could not reach the server. Check your connection and try again.');
    }
  }

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
              <KeyRound size={26} className="text-white" />
            </div>
            <h1 className="text-lg font-bold text-white">Forgot your password?</h1>
            <p className="mt-1 text-sm text-white/60">
              We&apos;ll email you a link to reset it
            </p>
          </div>

          <div className="px-6 py-6 space-y-4">
            {status === 'sent' ? (
              <div className="text-center space-y-3">
                <CheckCircle2 size={40} className="mx-auto text-green-400" />
                <p className="text-sm font-semibold text-brand-navy">Check your inbox</p>
                <p className="text-sm text-gray-400 leading-relaxed">
                  If an account exists for <span className="font-medium text-gray-600">{email.trim()}</span>,
                  a reset email has been sent. The link expires shortly, so use it soon.
                </p>
              </div>
            ) : (
              <form onSubmit={submit} className="space-y-4">
                <div>
                  <label
                    htmlFor="forgot-email"
                    className="mb-1.5 block text-xs font-semibold text-gray-400 uppercase tracking-wide"
                  >
                    Email address
                  </label>
                  <input
                    id="forgot-email"
                    type="email"
                    required
                    autoComplete="email"
                    placeholder="you@example.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="w-full rounded-xl border border-gray-200 bg-brand-bg px-4 py-3 text-sm text-brand-navy placeholder:text-gray-300 focus:border-brand-navy focus:outline-none transition-colors"
                  />
                </div>

                {status === 'error' && errorMsg && (
                  <div className="flex items-start gap-2 rounded-xl bg-red-50 px-3.5 py-2.5 text-xs text-red-600">
                    <AlertCircle size={14} className="mt-0.5 flex-shrink-0" />
                    <span>{errorMsg}</span>
                  </div>
                )}

                <button
                  type="submit"
                  disabled={status === 'submitting'}
                  className="flex w-full items-center justify-center gap-2 rounded-xl bg-brand-navy py-3 text-sm font-bold text-white hover:bg-brand-navy/90 active:scale-[0.98] transition-all disabled:opacity-60 disabled:active:scale-100"
                >
                  {status === 'submitting' && <Loader2 size={15} className="animate-spin" />}
                  {status === 'submitting' ? 'Sending…' : 'Send reset email'}
                </button>
              </form>
            )}

            <p className="text-center text-xs text-gray-400">
              Remembered it?{' '}
              <Link href="/" className="font-semibold text-brand-navy hover:underline">
                Back to sign in
              </Link>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
