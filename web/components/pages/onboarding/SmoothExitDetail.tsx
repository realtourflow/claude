"use client";

import { useState } from 'react';
import { useRouter, useSearchParams } from "next/navigation";
import { LogOut, Check, ChevronDown, ChevronUp, ArrowRight, ArrowLeft } from 'lucide-react';
import {
  SMOOTH_EXIT_FEATURES,
  SMOOTH_EXIT_UPSELLS,
  SmoothExitUpsellId,
  calcSmoothExitUpsellTotal,
} from "@/lib/data/mockSmoothExit";

const BENEFITS = [
  {
    emoji: '🏆',
    headline: 'Your listing closes faster and cleaner',
    payoff:
      "A seller who has pre-coordinated everything signals strength. Buyers know they're dealing with a smooth transaction — fewer hiccups, fewer contingencies, faster close.",
  },
  {
    emoji: '⏱️',
    headline: 'Get 30+ hours of your life back',
    payoff:
      'Movers, utilities, disclosures, repair bids, address changes — we handle the coordination while you pack your life and plan your next chapter.',
  },
  {
    emoji: '🏡',
    headline: 'Buy your next home before this one closes',
    payoff:
      'We coordinate bridge financing so you can make a strong, non-contingent offer on your next home before this sale closes. No double mortgages. No timing panic.',
  },
  {
    emoji: '📦',
    headline: 'Move-out day is already handled',
    payoff:
      'We confirm your movers, coordinate the deep clean, and manage the schedule — so move-out day is a handoff, not a hustle.',
  },
  {
    emoji: '🛡️',
    headline: 'Repair requests without the back-and-forth',
    payoff:
      'When the buyer submits repair requests, we coordinate contractor bids, track timelines, and keep your agent informed — so you respond from clarity, not panic.',
  },
  {
    emoji: '📋',
    headline: 'Title, disclosures, and paperwork — all tracked',
    payoff:
      'From disclosure packet organization to title company communication and proceeds wiring confirmation, someone is watching every thread from listing to close.',
  },
];

export default function SmoothExitDetail() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const fromOnboarding = searchParams.get('fromOnboarding') === 'true';
  const dealId = searchParams.get('dealId');
  const [selectedUpsells, setSelectedUpsells] = useState<SmoothExitUpsellId[]>([]);
  const [expanded, setExpanded] = useState<SmoothExitUpsellId | null>(null);
  const [expandedBenefit, setExpandedBenefit] = useState<string | null>(null);

  const upsellTotal = calcSmoothExitUpsellTotal(selectedUpsells);

  function toggleUpsell(id: SmoothExitUpsellId) {
    setSelectedUpsells((prev) =>
      prev.includes(id) ? prev.filter((u) => u !== id) : [...prev, id]
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Back nav */}
      <div className="sticky top-0 z-10 flex items-center gap-2 border-b border-white/10 bg-brand-navy px-4 py-3">
        <button
          onClick={() => fromOnboarding ? router.push('/onboard/seller') : router.back()}
          className="flex items-center gap-1 text-sm text-white/60 hover:text-white transition-colors"
        >
          <ArrowLeft size={15} />
          Back
        </button>
      </div>

      {/* Hero */}
      <div className="bg-brand-navy px-6 py-10 text-center">
        <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-purple-400">
          <LogOut size={28} className="text-white" />
        </div>
        <h1 className="text-3xl font-black text-white">Smooth Exit</h1>
        <p className="mt-1 text-purple-300 font-semibold text-xs uppercase tracking-widest">
          Seller Concierge Service
        </p>
        <p className="mt-4 mx-auto max-w-md text-sm text-white/70 leading-relaxed">
          We coordinate everything from listing prep to move-out day — so you can focus on what&apos;s next.
        </p>
        <div className="mt-6 inline-block rounded-2xl bg-white/10 px-6 py-3">
          <span className="text-3xl font-black text-white">1%</span>
          <span className="ml-2 text-sm text-white/50">of sale price · paid from proceeds</span>
        </div>
        <div className="mt-4 flex justify-center">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-purple-400/20 border border-purple-400/40 px-3 py-1 text-xs font-bold text-purple-300">
            🏡 Includes Buy Before You Sell
          </span>
        </div>
      </div>

      {/* Benefits — accordion */}
      <div className="bg-white border-b border-gray-100">
        <div className="mx-auto max-w-lg divide-y divide-gray-50">
          {BENEFITS.map(({ emoji, headline, payoff }) => {
            const isOpen = expandedBenefit === headline;
            return (
              <button
                key={headline}
                onClick={() => setExpandedBenefit(isOpen ? null : headline)}
                className="w-full px-5 py-4 text-left transition-colors hover:bg-gray-50/60 active:bg-gray-100/60"
              >
                <div className="flex items-center gap-3">
                  <span className="text-2xl leading-none flex-shrink-0">{emoji}</span>
                  <span className="flex-1 font-bold text-brand-navy leading-snug text-sm">
                    {headline}
                  </span>
                  {isOpen ? (
                    <ChevronUp size={15} className="flex-shrink-0 text-gray-300" />
                  ) : (
                    <ChevronDown size={15} className="flex-shrink-0 text-gray-300" />
                  )}
                </div>
                {isOpen && (
                  <p className="mt-3 ml-9 text-sm text-gray-500 leading-relaxed">{payoff}</p>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* Guarantee & payment options */}
      <div className="bg-purple-50 border-y border-purple-100 px-5 py-7">
        <div className="mx-auto max-w-lg space-y-5">
          <div className="text-center">
            <div className="text-2xl mb-1">💜</div>
            <h2 className="text-lg font-black text-brand-navy">Nothing out of pocket. Ever.</h2>
            <p className="mt-1 text-sm text-gray-500">
              The fee comes from your sale proceeds — two ways to structure it.
            </p>
          </div>

          {/* Payment options */}
          <div className="space-y-2">
            {[
              {
                badge: 'Most common',
                badgeColor: 'bg-purple-500 text-white',
                title: 'From sale proceeds',
                desc: 'The 1% fee is deducted automatically at closing. You never write a check.',
                note: '1% at closing',
              },
              {
                badge: '$0 net cost',
                badgeColor: 'bg-blue-100 text-blue-700',
                title: 'Buyer concession',
                desc: 'Ask your agent to negotiate the Smooth Exit fee into the offer. Buyer pays at closing.',
                note: 'Discuss with your agent',
              },
            ].map(({ badge, badgeColor, title, desc, note }) => (
              <div key={title} className="flex items-start gap-3 rounded-xl bg-white px-4 py-3.5 shadow-sm">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-0.5">
                    <span className="text-sm font-bold text-brand-navy">{title}</span>
                    <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-bold ${badgeColor}`}>
                      {badge}
                    </span>
                  </div>
                  <p className="text-xs text-gray-500 leading-relaxed">{desc}</p>
                </div>
                <span className="flex-shrink-0 text-right text-xs font-semibold text-gray-400 mt-0.5">
                  {note}
                </span>
              </div>
            ))}
          </div>

          {/* Refund policy */}
          <div className="rounded-xl border border-purple-200 bg-white px-4 py-4 space-y-2.5">
            <div className="text-xs font-bold uppercase tracking-wider text-gray-400">Refund policy</div>
            {[
              {
                icon: '✅',
                text: 'Deal falls through before going under contract → full refund, no questions asked.',
              },
              {
                icon: '✅',
                text: 'Cancel any time before listing is active → full refund.',
              },
              {
                icon: '⚠️',
                text: 'Cancel after going under contract (services underway) → full refund minus $500.',
                sub: 'Covers move-out coordination, repair bid work, and concierge time already invested.',
              },
            ].map(({ icon, text, sub }) => (
              <div key={text} className="flex items-start gap-2.5">
                <span className="text-base leading-none flex-shrink-0 mt-0.5">{icon}</span>
                <div>
                  <p className="text-xs text-gray-700 leading-relaxed">{text}</p>
                  {sub && <p className="mt-0.5 text-xs text-gray-400 italic">{sub}</p>}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-lg px-4 pb-36 pt-8 space-y-8">
        {/* Base features */}
        <section>
          <h2 className="mb-3 text-xs font-bold uppercase tracking-widest text-gray-400">
            Everything included at 1%
          </h2>
          <div className="rounded-2xl bg-white shadow-sm overflow-hidden divide-y divide-gray-50">
            {SMOOTH_EXIT_FEATURES.map((feature, i) => (
              <div key={i} className="flex items-start gap-3 px-5 py-3.5">
                <div className="mt-0.5 flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full bg-purple-100">
                  <Check size={11} className="text-purple-600" strokeWidth={3} />
                </div>
                <span className="text-sm text-gray-700">{feature}</span>
              </div>
            ))}
          </div>
        </section>

        {/* Upsells */}
        <section>
          <h2 className="mb-1 text-xs font-bold uppercase tracking-widest text-gray-400">
            Optional add-ons
          </h2>
          <p className="mb-4 text-xs text-gray-400">
            Select the extras that fit your situation — you can adjust during checkout.
          </p>
          <div className="space-y-2">
            {SMOOTH_EXIT_UPSELLS.map((upsell) => {
              const isSelected = selectedUpsells.includes(upsell.id);
              const isExpanded = expanded === upsell.id;
              return (
                <div
                  key={upsell.id}
                  className={[
                    'rounded-2xl border-2 bg-white overflow-hidden transition-all',
                    isSelected ? 'border-purple-400' : 'border-gray-100',
                  ].join(' ')}
                >
                  <div className="flex items-center gap-3 px-4 py-3.5">
                    <button
                      onClick={() => toggleUpsell(upsell.id)}
                      className={[
                        'flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full border-2 transition-all',
                        isSelected
                          ? 'border-purple-500 bg-purple-500'
                          : 'border-gray-200 bg-white hover:border-gray-300',
                      ].join(' ')}
                    >
                      {isSelected && <Check size={12} className="text-white" strokeWidth={3} />}
                    </button>

                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-semibold text-brand-navy">{upsell.name}</div>
                      {!isExpanded && (
                        <div className="text-xs text-gray-400 leading-snug mt-0.5 truncate">
                          {upsell.tagline}
                        </div>
                      )}
                    </div>

                    <span className="flex-shrink-0 text-sm font-bold text-brand-navy">
                      +${upsell.price}
                    </span>

                    <button
                      onClick={() => setExpanded(isExpanded ? null : upsell.id)}
                      className="ml-1 flex-shrink-0 text-gray-300 hover:text-gray-500 transition-colors"
                    >
                      {isExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                    </button>
                  </div>

                  {isExpanded && (
                    <div className="border-t border-gray-50 px-4 pb-4 pt-3 space-y-2">
                      <p className="text-xs text-gray-500 italic">{upsell.tagline}</p>
                      {upsell.details.map((d, i) => (
                        <div key={i} className="flex items-start gap-2 text-xs text-gray-600">
                          <span className="mt-1.5 h-1 w-1 rounded-full bg-gray-300 flex-shrink-0" />
                          {d}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </section>

        {/* Fine print */}
        <p className="text-center text-xs text-gray-300 leading-relaxed">
          Smooth Exit is available exclusively to Mountain Mortgage sellers. Your concierge will reach out within 24 hours of enrollment. This fee covers coordination services — not the cost of movers, cleaners, or other vendors.
        </p>
      </div>

      {/* Sticky footer */}
      <div className="fixed bottom-0 left-0 right-0 border-t border-gray-100 bg-white px-4 py-4 shadow-xl">
        <div className="mx-auto flex max-w-lg items-center gap-4">
          <div className="flex-1">
            <div className="text-xs text-gray-400 font-medium">Base fee</div>
            <div className="text-xl font-black text-brand-navy">1% at closing</div>
            {selectedUpsells.length > 0 && (
              <div className="text-xs text-purple-600 font-medium">
                + ${upsellTotal} in add-ons
              </div>
            )}
          </div>
          <button
            onClick={() => {
              // Next.js's router.push doesn't accept React Router's
              // `{ state }` second arg. Stash payload in sessionStorage
              // so the destination survey page can read it.
              if (typeof window !== "undefined") {
                sessionStorage.setItem(
                  "smoothExitSurveyState",
                  JSON.stringify({ selectedUpsells, upsellTotal, dealId })
                );
              }
              router.push(
                fromOnboarding
                  ? "/smooth-exit/survey?fromOnboarding=true"
                  : "/smooth-exit/survey"
              );
            }}
            className="flex items-center gap-2 rounded-xl bg-purple-700 px-6 py-3.5 text-sm font-bold text-white hover:bg-purple-800 transition-all active:scale-[0.98]"
          >
            {fromOnboarding ? 'Continue →' : 'Get Started'} <ArrowRight size={16} />
          </button>
        </div>
      </div>
    </div>
  );
}
