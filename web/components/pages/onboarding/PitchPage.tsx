"use client";

import { Zap, Users } from 'lucide-react';

export type LenderChoice = 'mountain' | 'fastpass' | 'other';

type Props = {
  onSelect: (choice: LenderChoice) => void;
};

export default function PitchPage({ onSelect }: Props) {
  return (
    <div className="screen-enter flex flex-col items-center">
      <h2 className="mb-2 text-center text-2xl font-bold text-brand-navy">
        How would you like to handle financing?
      </h2>
      <p className="mb-8 text-center text-sm text-gray-400">
        Choose the option that fits you best — you can always change later.
      </p>

      <div className="w-full max-w-md space-y-3">
        {/* Mountain Mortgage — featured */}
        <button
          onClick={() => onSelect('mountain')}
          className="group w-full overflow-hidden rounded-2xl bg-brand-navy p-5 text-left transition-all hover:bg-brand-navy/90 active:scale-[0.99]"
        >
          <div className="mb-1 flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-gold text-brand-navy font-black text-sm">
              M
            </div>
            <span className="text-xs font-bold uppercase tracking-widest text-brand-gold">
              Preferred Lender
            </span>
          </div>
          <div className="mt-2 text-lg font-bold text-white">Mountain Mortgage</div>
          <p className="mt-1 text-sm text-white/70">
            Fast approvals, local team, and fully integrated with RealTour Flow for a seamless experience.
          </p>
        </button>

        {/* Fast Pass */}
        <button
          onClick={() => onSelect('fastpass')}
          className="w-full rounded-2xl border-2 border-green-200 bg-green-50 overflow-hidden p-5 text-left transition-all hover:border-green-300 hover:bg-green-100 active:scale-[0.99]"
        >
          <div className="mb-1 flex items-center gap-2">
            <Zap size={16} className="text-green-600" />
            <span className="text-xs font-bold uppercase tracking-widest text-green-600">
              Concierge Service
            </span>
          </div>
          <div className="mt-2 text-lg font-bold text-green-900">Fast Pass</div>
          <p className="mt-1 text-sm text-green-800/70">
            Most buyers spend 30+ hours chasing vendors and paperwork. Fast Pass buyers don&apos;t.
          </p>
          <p className="mt-3 text-xs font-semibold text-green-700">See what&apos;s included →</p>
        </button>

        {/* Other lender */}
        <button
          onClick={() => onSelect('other')}
          className="group w-full overflow-hidden rounded-2xl border border-gray-200 bg-gray-50 p-5 text-left transition-all hover:bg-gray-100 active:scale-[0.99]"
        >
          <div className="mb-1 flex items-center gap-2">
            <Users size={16} className="text-gray-400" />
            <span className="text-xs font-bold uppercase tracking-widest text-gray-400">
              Already have a lender
            </span>
          </div>
          <div className="mt-2 text-lg font-bold text-gray-700">I have my own lender</div>
          <p className="mt-1 text-sm text-gray-500">
            No problem — we&apos;ll coordinate directly with your lender throughout the process.
          </p>
        </button>
      </div>
    </div>
  );
}
