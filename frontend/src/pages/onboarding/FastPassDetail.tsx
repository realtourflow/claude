import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Zap, Check, ChevronDown, ChevronUp, ArrowRight, ArrowLeft } from 'lucide-react';
import {
  FAST_PASS_BASE_PRICE,
  FAST_PASS_BASE_FEATURES,
  FAST_PASS_UPSELLS,
  FastPassUpsellId,
  calcFastPassTotal,
} from '../../data/mockFastPass';

const BENEFITS = [
  {
    emoji: '🚀',
    headline: 'Your offer wins before price enters the conversation',
    payoff:
      'A 10-day close makes sellers pick you over buyers who need 45 days — even at the same price.',
  },
  {
    emoji: '⏱️',
    headline: 'Get 30+ hours of your life back',
    payoff:
      'Stop chasing vendors, Googling paperwork, and wondering who to call at 10pm. We handle all of it.',
  },
  {
    emoji: '🛡️',
    headline: "Your rate isn't a life sentence",
    payoff:
      'After 7 months from purchase, you have a 2% lender credit available for a refinance — any time you decide to use it. Lock in today without the regret.',
  },
  {
    emoji: '📦',
    headline: 'Moving day is already planned',
    payoff:
      'You wake up with a crew confirmed, a schedule set, and a coordinator on call. Not chaos.',
  },
  {
    emoji: '🤝',
    headline: "You're not navigating the biggest purchase of your life alone",
    payoff:
      'Someone who has done this 1,000 times is in your corner from pre-approval to the day you get your keys.',
  },
  {
    emoji: '🔑',
    headline: 'Already own a home? Buy your next one before selling',
    payoff:
      "We coordinate bridge financing so you can make a strong, non-contingent offer on your next home before your current one sells — no timing panic, no lowball contingency offers.",
  },
];

export default function FastPassDetail() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const fromOnboarding = searchParams.get('fromOnboarding') === 'true';
  const [selectedUpsells, setSelectedUpsells] = useState<FastPassUpsellId[]>([]);
  const [expanded, setExpanded] = useState<FastPassUpsellId | null>(null);
  const [expandedBenefit, setExpandedBenefit] = useState<string | null>(null);

  const total = calcFastPassTotal(selectedUpsells);

  function toggleUpsell(id: FastPassUpsellId) {
    setSelectedUpsells((prev) =>
      prev.includes(id) ? prev.filter((u) => u !== id) : [...prev, id]
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Back nav */}
      <div className="sticky top-0 z-10 flex items-center gap-2 border-b border-white/10 bg-brand-navy px-4 py-3">
        <button
          onClick={() => fromOnboarding ? navigate('/onboard/buyer') : navigate(-1)}
          className="flex items-center gap-1 text-sm text-white/60 hover:text-white transition-colors"
        >
          <ArrowLeft size={15} />
          Back
        </button>
      </div>

      {/* Hero */}
      <div className="bg-brand-navy px-6 py-10 text-center">
        <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-green-400">
          <Zap size={28} className="text-brand-navy" />
        </div>
        <h1 className="text-3xl font-black text-white">Fast Pass</h1>
        <p className="mt-1 text-brand-gold font-semibold text-xs uppercase tracking-widest">
          White-Glove Concierge Service
        </p>
        <p className="mt-4 mx-auto max-w-md text-sm text-white/70 leading-relaxed">
          We handle every coordination task from pre-approval to move-in day — so you can focus on what actually matters.
        </p>
        <div className="mt-6 inline-block rounded-2xl bg-white/10 px-6 py-3">
          <span className="text-3xl font-black text-white">${FAST_PASS_BASE_PRICE.toLocaleString()}</span>
          <span className="ml-2 text-sm text-white/50">flat fee</span>
        </div>
        <div className="mt-4 flex justify-center">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-brand-gold/20 border border-brand-gold/40 px-3 py-1 text-xs font-bold text-brand-gold">
            🔑 Includes Buy Before You Sell
          </span>
        </div>
      </div>

      {/* Benefits — accordion, no section label */}
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
                  <p className="mt-3 ml-9 text-sm text-gray-500 leading-relaxed">
                    {payoff}
                  </p>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* Guarantee & payment options */}
      <div className="bg-green-50 border-y border-green-100 px-5 py-7">
        <div className="mx-auto max-w-lg space-y-5">
          <div className="text-center">
            <div className="text-2xl mb-1">💚</div>
            <h2 className="text-lg font-black text-brand-navy">You don't pay unless it works.</h2>
            <p className="mt-1 text-sm text-gray-500">
              Three ways to pay — and a refund policy with no fine print.
            </p>
          </div>

          {/* Payment options */}
          <div className="space-y-2">
            {[
              {
                badge: 'Best value',
                badgeColor: 'bg-green-500 text-white',
                title: 'Pay now',
                desc: 'Invoice sent within 24 hours. Fast Pass activates as soon as payment clears.',
                note: `$${FAST_PASS_BASE_PRICE.toLocaleString()} flat`,
              },
              {
                badge: '+15%',
                badgeColor: 'bg-gray-100 text-gray-500',
                title: 'Pay at closing',
                desc: 'No money out of pocket today. The fee is added to your closing costs.',
                note: 'Added to closing statement',
              },
              {
                badge: '$0 out of pocket',
                badgeColor: 'bg-blue-100 text-blue-700',
                title: 'Seller concession',
                desc: 'Ask your agent to negotiate the Fast Pass fee into your offer. Seller pays at closing.',
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
          <div className="rounded-xl border border-green-200 bg-white px-4 py-4 space-y-2.5">
            <div className="text-xs font-bold uppercase tracking-wider text-gray-400">Refund policy</div>
            {[
              {
                icon: '✅',
                text: 'Deal falls through and you stop looking → full refund, no questions asked.',
              },
              {
                icon: '✅',
                text: 'Cancel any time before going under contract → full refund.',
              },
              {
                icon: '⚠️',
                text: 'Cancel after going under contract (once services have started) → full refund minus $1,000.',
                sub: "This covers the 10-day close track, priority scheduling, and 24/7 care we've already provided.",
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
            Everything included at the base price
          </h2>
          <div className="rounded-2xl bg-white shadow-sm overflow-hidden divide-y divide-gray-50">
            {FAST_PASS_BASE_FEATURES.map((feature, i) => (
              <div key={i} className="flex items-start gap-3 px-5 py-3.5">
                <div className="mt-0.5 flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full bg-green-100">
                  <Check size={11} className="text-green-600" strokeWidth={3} />
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
            {FAST_PASS_UPSELLS.map((upsell) => {
              const isSelected = selectedUpsells.includes(upsell.id);
              const isExpanded = expanded === upsell.id;
              return (
                <div
                  key={upsell.id}
                  className={[
                    'rounded-2xl border-2 bg-white overflow-hidden transition-all',
                    isSelected ? 'border-green-400' : 'border-gray-100',
                  ].join(' ')}
                >
                  <div className="flex items-center gap-3 px-4 py-3.5">
                    <button
                      onClick={() => toggleUpsell(upsell.id)}
                      className={[
                        'flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full border-2 transition-all',
                        isSelected
                          ? 'border-green-500 bg-green-500'
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
          Fast Pass is available exclusively to Mountain Mortgage buyers. Your concierge will send an invoice within 24 hours of enrollment. This fee covers coordination services — not the cost of movers, cleaners, or other vendors.
        </p>
      </div>

      {/* Sticky footer */}
      <div className="fixed bottom-0 left-0 right-0 border-t border-gray-100 bg-white px-4 py-4 shadow-xl">
        <div className="mx-auto flex max-w-lg items-center gap-4">
          <div className="flex-1">
            <div className="text-xs text-gray-400 font-medium">Total</div>
            <div className="text-xl font-black text-brand-navy">
              ${total.toLocaleString()}
            </div>
            {selectedUpsells.length > 0 && (
              <div className="text-xs text-green-600 font-medium">
                Base + {selectedUpsells.length} add-on{selectedUpsells.length !== 1 ? 's' : ''}
              </div>
            )}
          </div>
          <button
            onClick={() =>
              navigate(
                fromOnboarding
                  ? '/fast-pass/survey?fromOnboarding=true'
                  : '/fast-pass/survey',
                { state: { selectedUpsells, total } }
              )
            }
            className="flex items-center gap-2 rounded-xl bg-brand-navy px-6 py-3.5 text-sm font-bold text-white hover:bg-brand-navy/90 transition-all active:scale-[0.98]"
          >
            {fromOnboarding ? 'Continue →' : 'Get Started'} <ArrowRight size={16} />
          </button>
        </div>
      </div>
    </div>
  );
}
