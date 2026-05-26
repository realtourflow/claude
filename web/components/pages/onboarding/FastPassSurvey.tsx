"use client";

import { useState } from 'react';
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { useAuthStore } from '../../store/authStore';
import { CheckCircle2, ChevronRight, ChevronLeft, Check } from 'lucide-react';
import {
  FastPassUpsellId,
  FastPassPaymentOption,
  FAST_PASS_UPSELLS,
  calcFastPassTotal,
  FAST_PASS_BASE_PRICE,
} from '../../data/mockFastPass';
import { api } from '../../api/client';

// ─── Types ────────────────────────────────────────────────────────────────────

type SurveyData = {
  currentSituation: string;
  targetMoveDate: string;
  dateFlexibility: string;
  moveSize: string;
  moverPreference: string;
  packingPreference: string;
  utilities: string[];
  notes: string;
};

const EMPTY: SurveyData = {
  currentSituation: '',
  targetMoveDate: '',
  dateFlexibility: '',
  moveSize: '',
  moverPreference: '',
  packingPreference: '',
  utilities: [],
  notes: '',
};

type LocationState = {
  selectedUpsells?: FastPassUpsellId[];
  total?: number;
  dealId?: string | null;
};

const UTILITY_OPTIONS = [
  'Electric',
  'Natural Gas',
  'Water / Sewer',
  'Internet',
  'Cable / Streaming',
  'Trash & Recycling',
  'Home Security',
];

const TOTAL_SCREENS = 5;

// ─── Shared UI ────────────────────────────────────────────────────────────────

function Question({ text, note }: { text: string; note?: string }) {
  return (
    <div className="mb-7 text-center">
      <h2 className="text-2xl font-bold leading-snug text-brand-navy">{text}</h2>
      {note && <p className="mt-2 text-sm text-gray-400">{note}</p>}
    </div>
  );
}

function OptionBtn({
  label,
  sub,
  selected,
  onClick,
}: {
  label: string;
  sub?: string;
  selected?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={[
        'w-full rounded-xl py-3.5 px-4 text-left transition-all active:scale-[0.98]',
        selected
          ? 'bg-brand-navy text-white'
          : 'bg-gray-100 text-brand-navy hover:bg-gray-200',
      ].join(' ')}
    >
      <div className="font-bold text-sm">{label}</div>
      {sub && (
        <div
          className={[
            'text-xs mt-0.5',
            selected ? 'text-white/60' : 'text-gray-400',
          ].join(' ')}
        >
          {sub}
        </div>
      )}
    </button>
  );
}

// ─── Screen 0: Move Basics ────────────────────────────────────────────────────

function MoveSituationScreen({
  data,
  onChange,
  onNext,
}: {
  data: SurveyData;
  onChange: (k: keyof SurveyData, v: string) => void;
  onNext: () => void;
}) {
  const situations = [
    { value: 'renting', label: 'Currently renting', sub: "I'll move out of a rental" },
    { value: 'selling', label: 'Selling my current home', sub: 'Coordinating two transactions' },
    { value: 'relocating', label: 'Relocating from out of state', sub: 'Long-distance move' },
    { value: 'other', label: 'Other situation', sub: "My concierge will ask me more" },
  ];
  const flexOptions = [
    { value: 'firm', label: 'Hard deadline — must hit it' },
    { value: 'somewhat', label: "Somewhat flexible (±2 weeks)" },
    { value: 'flexible', label: 'Very flexible' },
  ];

  const canContinue = data.currentSituation && data.targetMoveDate && data.dateFlexibility;

  return (
    <div className="screen-enter flex flex-col items-center">
      <Question text="Tell us about your move" note="We'll use this to start coordinating right away" />
      <div className="w-full max-w-sm space-y-5">
        <div>
          <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-gray-400">
            Current situation
          </div>
          <div className="space-y-2">
            {situations.map((s) => (
              <OptionBtn
                key={s.value}
                label={s.label}
                sub={s.sub}
                selected={data.currentSituation === s.value}
                onClick={() => onChange('currentSituation', s.value)}
              />
            ))}
          </div>
        </div>

        <div>
          <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-gray-400">
            When do you want to move in?
          </div>
          <div className="space-y-2">
            {[
              { value: 'day_of_closing', label: 'Day of closing' },
              { value: 'after_closing', label: 'After closing' },
            ].map((opt) => (
              <OptionBtn
                key={opt.value}
                label={opt.label}
                selected={data.targetMoveDate === opt.value}
                onClick={() => onChange('targetMoveDate', opt.value)}
              />
            ))}
          </div>
          <textarea
            value={['day_of_closing', 'after_closing'].includes(data.targetMoveDate) ? '' : data.targetMoveDate}
            onChange={(e) => onChange('targetMoveDate', e.target.value)}
            placeholder="Please give us details if those answers don't fit what you're looking for"
            rows={3}
            className="mt-2 w-full rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-800 outline-none focus:border-brand-navy/30 focus:ring-2 focus:ring-brand-navy/10"
          />
        </div>

        <div>
          <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-gray-400">
            Date flexibility
          </div>
          <div className="space-y-2">
            {flexOptions.map((f) => (
              <OptionBtn
                key={f.value}
                label={f.label}
                selected={data.dateFlexibility === f.value}
                onClick={() => onChange('dateFlexibility', f.value)}
              />
            ))}
          </div>
        </div>

        <button
          onClick={onNext}
          disabled={!canContinue}
          className={[
            'flex w-full items-center justify-center gap-2 rounded-xl py-4 text-base font-bold transition-all',
            canContinue
              ? 'bg-brand-navy text-white hover:bg-brand-navy/80 active:scale-[0.98]'
              : 'cursor-not-allowed bg-gray-100 text-gray-300',
          ].join(' ')}
        >
          Continue <ChevronRight size={18} />
        </button>
      </div>
    </div>
  );
}

// ─── Screen 1: Moving Preferences ────────────────────────────────────────────

function MovingPreferencesScreen({
  data,
  onChange,
  onNext,
}: {
  data: SurveyData;
  onChange: (k: keyof SurveyData, v: string) => void;
  onNext: () => void;
}) {
  const sizes = [
    { value: 'studio', label: 'Studio / 1 bed' },
    { value: '2bed', label: '2 bedrooms' },
    { value: '3bed', label: '3 bedrooms' },
    { value: '4plus', label: '4+ bedrooms' },
  ];
  const movers = [
    { value: 'coordinate', label: 'Coordinate movers for me', sub: 'Included in Fast Pass' },
    { value: 'booked', label: "I've already booked movers" },
    { value: 'self', label: "I'm handling it myself" },
  ];
  const packing = [
    { value: 'full', label: 'Full service — they pack everything' },
    { value: 'partial', label: 'Partial — I pack valuables, they do the rest' },
    { value: 'self', label: "Self-pack — I'll handle all packing" },
  ];

  const canContinue = data.moveSize && data.moverPreference && data.packingPreference;

  return (
    <div className="screen-enter flex flex-col items-center">
      <Question text="How are you moving?" />
      <div className="w-full max-w-sm space-y-5">
        <div>
          <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-gray-400">
            Home size
          </div>
          <div className="grid grid-cols-2 gap-2">
            {sizes.map((s) => (
              <OptionBtn
                key={s.value}
                label={s.label}
                selected={data.moveSize === s.value}
                onClick={() => onChange('moveSize', s.value)}
              />
            ))}
          </div>
        </div>

        <div>
          <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-gray-400">
            Moving company
          </div>
          <div className="space-y-2">
            {movers.map((m) => (
              <OptionBtn
                key={m.value}
                label={m.label}
                sub={m.sub}
                selected={data.moverPreference === m.value}
                onClick={() => onChange('moverPreference', m.value)}
              />
            ))}
          </div>
        </div>

        <div>
          <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-gray-400">
            Packing preference
          </div>
          <div className="space-y-2">
            {packing.map((p) => (
              <OptionBtn
                key={p.value}
                label={p.label}
                selected={data.packingPreference === p.value}
                onClick={() => onChange('packingPreference', p.value)}
              />
            ))}
          </div>
        </div>

        <button
          onClick={onNext}
          disabled={!canContinue}
          className={[
            'flex w-full items-center justify-center gap-2 rounded-xl py-4 text-base font-bold transition-all',
            canContinue
              ? 'bg-brand-navy text-white hover:bg-brand-navy/80 active:scale-[0.98]'
              : 'cursor-not-allowed bg-gray-100 text-gray-300',
          ].join(' ')}
        >
          Continue <ChevronRight size={18} />
        </button>
      </div>
    </div>
  );
}

// ─── Screen 2: Utilities ──────────────────────────────────────────────────────

function UtilitiesScreen({
  data,
  onChange,
  onNext,
}: {
  data: SurveyData;
  onChange: (k: keyof SurveyData, v: string[]) => void;
  onNext: () => void;
}) {
  function toggle(util: string) {
    const prev = data.utilities;
    onChange(
      'utilities',
      prev.includes(util) ? prev.filter((u) => u !== util) : [...prev, util]
    );
  }

  return (
    <div className="screen-enter flex flex-col items-center">
      <Question
        text="Which utilities need to be set up?"
        note="We'll contact providers and schedule start dates for the ones you select"
      />
      <div className="w-full max-w-sm space-y-4">
        <div className="space-y-2">
          {UTILITY_OPTIONS.map((util) => {
            const selected = data.utilities.includes(util);
            return (
              <button
                key={util}
                onClick={() => toggle(util)}
                className={[
                  'flex w-full items-center gap-3 rounded-xl px-4 py-3.5 transition-all active:scale-[0.98]',
                  selected
                    ? 'bg-brand-navy text-white'
                    : 'bg-gray-100 text-brand-navy hover:bg-gray-200',
                ].join(' ')}
              >
                <div
                  className={[
                    'flex h-5 w-5 flex-shrink-0 items-center justify-center rounded border-2 transition-all',
                    selected
                      ? 'border-white bg-white'
                      : 'border-gray-300 bg-white',
                  ].join(' ')}
                >
                  {selected && <Check size={11} className="text-brand-navy" strokeWidth={3} />}
                </div>
                <span className="text-sm font-semibold">{util}</span>
              </button>
            );
          })}
        </div>

        <p className="text-center text-xs text-gray-400">
          Select all that apply — or skip if you're handling utilities yourself
        </p>

        <button
          onClick={onNext}
          className="flex w-full items-center justify-center gap-2 rounded-xl bg-brand-navy py-4 text-base font-bold text-white hover:bg-brand-navy/80 transition-all active:scale-[0.98]"
        >
          Continue <ChevronRight size={18} />
        </button>
      </div>
    </div>
  );
}

// ─── Screen 3: Notes ─────────────────────────────────────────────────────────

function NotesScreen({
  data,
  onChange,
  onNext,
}: {
  data: SurveyData;
  onChange: (k: keyof SurveyData, v: string) => void;
  onNext: () => void;
}) {
  return (
    <div className="screen-enter flex flex-col items-center">
      <Question
        text="Anything else we should know?"
        note="Special access requirements, tight deadlines, or anything unique about your situation"
      />
      <div className="w-full max-w-sm">
        <textarea
          value={data.notes}
          onChange={(e) => onChange('notes', e.target.value)}
          placeholder="e.g. Need elevator access at the new building. Closing date may shift by a week..."
          rows={5}
          className="w-full rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-800 outline-none focus:border-brand-navy/30 focus:ring-2 focus:ring-brand-navy/10"
        />
        <button
          onClick={onNext}
          className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl bg-brand-navy py-4 text-base font-bold text-white hover:bg-brand-navy/80 transition-all active:scale-[0.98]"
        >
          Review & Submit <ChevronRight size={18} />
        </button>
      </div>
    </div>
  );
}

// ─── Screen 4: Confirmation ───────────────────────────────────────────────────

const PAYMENT_OPTIONS: {
  value: FastPassPaymentOption;
  badge: string;
  badgeStyle: string;
  title: string;
  desc: string;
  note: string;
}[] = [
  {
    value: 'now',
    badge: 'Best value',
    badgeStyle: 'bg-green-500 text-white',
    title: 'Pay now',
    desc: 'Invoice sent within 24 hours. Fast Pass activates as soon as payment clears.',
    note: 'No added cost',
  },
  {
    value: 'at_closing',
    badge: '+15%',
    badgeStyle: 'bg-gray-100 text-gray-500',
    title: 'Pay at closing',
    desc: 'Nothing due today. The fee is added to your closing costs.',
    note: 'Added to closing statement',
  },
  {
    value: 'seller_concession',
    badge: '$0 out of pocket',
    badgeStyle: 'bg-blue-100 text-blue-700',
    title: 'Seller concession',
    desc: 'Ask your agent to negotiate the Fast Pass fee into your offer. Seller pays at closing.',
    note: 'Discuss with your agent',
  },
];

function ConfirmationScreen({
  data,
  selectedUpsells,
  total,
  submitting,
  onSubmit,
}: {
  data: SurveyData;
  selectedUpsells: FastPassUpsellId[];
  total: number;
  submitting?: boolean;
  onSubmit: (paymentOption: FastPassPaymentOption) => void;
}) {
  const [paymentOption, setPaymentOption] = useState<FastPassPaymentOption | null>(null);
  const upsellItems = FAST_PASS_UPSELLS.filter((u) => selectedUpsells.includes(u.id));
  const situationLabels: Record<string, string> = {
    renting: 'Currently renting',
    selling: 'Selling current home',
    relocating: 'Relocating from out of state',
    other: 'Other',
  };

  const atClosingTotal = Math.round(total * 1.15);

  return (
    <div className="screen-enter flex flex-col items-center">
      <Question text="Review & check out" note="Choose how you'd like to pay — no money changes hands today" />
      <div className="w-full max-w-sm space-y-4">
        {/* Move summary */}
        <div className="rounded-2xl bg-white shadow-sm divide-y divide-gray-50">
          <div className="px-4 py-3">
            <div className="text-xs text-gray-400 font-medium">Situation</div>
            <div className="text-sm font-semibold text-brand-navy mt-0.5">
              {situationLabels[data.currentSituation] ?? data.currentSituation}
            </div>
          </div>
          {data.targetMoveDate && (
            <div className="px-4 py-3">
              <div className="text-xs text-gray-400 font-medium">Target move-in</div>
              <div className="text-sm font-semibold text-brand-navy mt-0.5">
                {({ day_of_closing: 'Day of closing', after_closing: 'After closing' } as Record<string, string>)[data.targetMoveDate] ?? data.targetMoveDate}
                {data.dateFlexibility === 'firm' && (
                  <span className="ml-2 rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-bold text-amber-700">
                    Hard deadline
                  </span>
                )}
              </div>
            </div>
          )}
          {data.utilities.length > 0 && (
            <div className="px-4 py-3">
              <div className="text-xs text-gray-400 font-medium">
                Utilities ({data.utilities.length})
              </div>
              <div className="text-sm text-brand-navy mt-0.5">{data.utilities.join(', ')}</div>
            </div>
          )}
        </div>

        {/* Pricing breakdown */}
        <div className="rounded-2xl bg-white shadow-sm overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-50">
            <div className="flex items-center justify-between">
              <span className="text-sm text-gray-600">Fast Pass base</span>
              <span className="text-sm font-semibold text-brand-navy">${FAST_PASS_BASE_PRICE.toLocaleString()}</span>
            </div>
          </div>
          {upsellItems.map((u) => (
            <div key={u.id} className="flex items-center justify-between px-4 py-2.5 border-b border-gray-50">
              <span className="text-sm text-gray-600">{u.name}</span>
              <span className="text-sm font-semibold text-brand-navy">+${u.price}</span>
            </div>
          ))}
          <div className="flex items-center justify-between px-4 py-3 bg-gray-50">
            <span className="text-sm font-bold text-brand-navy">Total</span>
            <span className="text-base font-black text-brand-navy">${total.toLocaleString()}</span>
          </div>
        </div>

        {/* Payment selection */}
        <div>
          <div className="mb-2 text-xs font-bold uppercase tracking-wider text-gray-400">
            How would you like to pay?
          </div>
          <div className="space-y-2">
            {PAYMENT_OPTIONS.map((opt) => {
              const isSelected = paymentOption === opt.value;
              const displayTotal =
                opt.value === 'at_closing' ? atClosingTotal : total;
              return (
                <button
                  key={opt.value}
                  onClick={() => setPaymentOption(opt.value)}
                  className={[
                    'w-full rounded-xl border-2 p-4 text-left transition-all active:scale-[0.99]',
                    isSelected
                      ? 'border-brand-navy bg-brand-navy/5'
                      : 'border-gray-100 bg-white hover:border-gray-200',
                  ].join(' ')}
                >
                  <div className="flex items-center justify-between mb-1">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-bold text-brand-navy">{opt.title}</span>
                      <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-bold ${opt.badgeStyle}`}>
                        {opt.badge}
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-black text-brand-navy">
                        ${displayTotal.toLocaleString()}
                      </span>
                      <div
                        className={[
                          'flex h-5 w-5 items-center justify-center rounded-full border-2 transition-all',
                          isSelected
                            ? 'border-brand-navy bg-brand-navy'
                            : 'border-gray-200',
                        ].join(' ')}
                      >
                        {isSelected && <Check size={10} className="text-white" strokeWidth={3} />}
                      </div>
                    </div>
                  </div>
                  <p className="text-xs text-gray-400 leading-relaxed">{opt.desc}</p>
                </button>
              );
            })}
          </div>
        </div>

        <button
          onClick={() => paymentOption && !submitting && onSubmit(paymentOption)}
          disabled={!paymentOption || submitting}
          className={[
            'flex w-full items-center justify-center gap-2 rounded-xl py-4 text-base font-bold transition-all',
            paymentOption && !submitting
              ? 'bg-green-500 text-white hover:bg-green-600 active:scale-[0.98]'
              : 'cursor-not-allowed bg-gray-100 text-gray-300',
          ].join(' ')}
        >
          {submitting ? 'Processing…' : 'Submit Request'} <ChevronRight size={18} />
        </button>
      </div>
    </div>
  );
}

// ─── Submitted ────────────────────────────────────────────────────────────────

const SUBMITTED_NOTES: Record<FastPassPaymentOption, string> = {
  now: 'Invoice on its way to your email — Fast Pass activates as soon as payment clears.',
  at_closing: "We'll add the fee to your closing costs. Nothing due today.",
  seller_concession: "Let your agent know — they'll negotiate the fee into your offer.",
};

function SubmittedScreen({
  total,
  paymentOption,
}: {
  total: number;
  paymentOption: FastPassPaymentOption;
}) {
  const router = useRouter();
  const activeUser = useAuthStore((s) => s.activeUser);
  function goToDashboard() {
    if (activeUser?.groupId === 'buyer') {
      router.push(`/buyer/${activeUser.id}`);
    } else {
      router.push('/buyer/buyer-smith');
    }
  }
  const atClosingTotal = Math.round(total * 1.15);
  const displayTotal = paymentOption === 'at_closing' ? atClosingTotal : total;

  return (
    <div className="screen-enter flex flex-col items-center py-8 text-center">
      <div className="mb-5 flex h-16 w-16 items-center justify-center rounded-2xl bg-green-100">
        <CheckCircle2 size={34} className="text-green-500" />
      </div>
      <h2 className="text-3xl font-black text-brand-navy">You're in!</h2>
      <p className="mt-3 max-w-sm text-sm leading-relaxed text-gray-500">
        {SUBMITTED_NOTES[paymentOption]}
      </p>
      <div className="mt-4 rounded-xl border border-green-200 bg-green-50 px-5 py-3 text-sm text-green-800">
        <span className="font-semibold">
          {paymentOption === 'now' ? 'Invoice amount:' : 'Total due at closing:'}
        </span>{' '}
        <span className="font-black">${displayTotal.toLocaleString()}</span>
      </div>
      <p className="mt-3 text-xs text-gray-300">
        Your dashboard will update once payment is confirmed.
      </p>
      <button
        onClick={goToDashboard}
        className="mt-8 flex items-center gap-2 rounded-xl bg-brand-navy px-8 py-4 text-base font-bold text-white hover:bg-brand-navy/80 transition-all active:scale-[0.98]"
      >
        Go to my dashboard <ChevronRight size={18} />
      </button>
    </div>
  );
}

// ─── Main ─────────────────────────────────────────────────────────────────────

export default function FastPassSurvey() {
  const router = useRouter();
  const location = usePathname();
  const searchParams = useSearchParams();
  const fromOnboarding = searchParams.get('fromOnboarding') === 'true';
  const state = (null as unknown) as LocationState | null;

  const selectedUpsells: FastPassUpsellId[] = state?.selectedUpsells ?? [];
  const total = state?.total ?? calcFastPassTotal(selectedUpsells);
  const dealId = state?.dealId ?? null;

  const [screen, setScreen] = useState(0);
  const [data, setData] = useState<SurveyData>(EMPTY);
  const [submitted, setSubmitted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [chosenPayment, setChosenPayment] = useState<FastPassPaymentOption>('now');

  const progress = Math.min(((screen + 1) / TOTAL_SCREENS) * 100, 100);

  function set<K extends keyof SurveyData>(key: K, val: SurveyData[K]) {
    setData((d) => ({ ...d, [key]: val }));
  }

  function next() {
    setScreen((s) => Math.min(s + 1, TOTAL_SCREENS - 1));
  }

  function back() {
    if (screen === 0) {
      router.push(-1);
    } else {
      setScreen((s) => Math.max(s - 1, 0));
    }
  }

  if (submitted) {
    return (
      <div className="flex min-h-screen flex-col bg-white px-4 py-8">
        <SubmittedScreen total={total} paymentOption={chosenPayment} />
      </div>
    );
  }

  function renderScreen() {
    switch (screen) {
      case 0:
        return (
          <MoveSituationScreen
            data={data}
            onChange={(k, v) => set(k, v as SurveyData[typeof k])}
            onNext={next}
          />
        );
      case 1:
        return (
          <MovingPreferencesScreen
            data={data}
            onChange={(k, v) => set(k, v as SurveyData[typeof k])}
            onNext={next}
          />
        );
      case 2:
        return (
          <UtilitiesScreen
            data={data}
            onChange={(k, v) => set(k, v as SurveyData[typeof k])}
            onNext={next}
          />
        );
      case 3:
        return (
          <NotesScreen
            data={data}
            onChange={(k, v) => set(k, v as SurveyData[typeof k])}
            onNext={next}
          />
        );
      case 4:
        return (
          <ConfirmationScreen
            data={data}
            selectedUpsells={selectedUpsells}
            total={total}
            submitting={submitting}
            onSubmit={async (option) => {
              setChosenPayment(option);
              if (dealId) {
                setSubmitting(true);
                try {
                  const atClosingTotal = Math.round(total * 1.15);
                  const totalCents = option === 'at_closing'
                    ? atClosingTotal * 100
                    : total * 100;
                  const res = await api.post<{ checkout_url?: string; ok?: boolean }>(
                    `/deals/${dealId}/fastpass`,
                    {
                      payment_option: option,
                      selected_upsells: selectedUpsells,
                      total_cents: totalCents,
                      survey_answers: data,
                    },
                  );
                  if (res.checkout_url) {
                    window.location.href = res.checkout_url;
                    return;
                  }
                } catch {
                  // fall through to show submitted screen
                } finally {
                  setSubmitting(false);
                }
              }
              if (fromOnboarding) {
                router.push('/onboard/buyer?resume=true');
              } else {
                setSubmitted(true);
              }
            }}
          />
        );
      default:
        return null;
    }
  }

  return (
    <div className="flex min-h-screen flex-col bg-white">
      {/* Progress bar */}
      <div className="sticky top-0 z-10 bg-white">
        <div className="h-1 w-full bg-gray-100">
          <div
            className="h-1 bg-brand-navy transition-all duration-300"
            style={{ width: `${progress}%` }}
          />
        </div>
        <div className="flex items-center justify-between px-4 py-3">
          <button
            onClick={back}
            className="flex items-center gap-1 text-sm text-gray-400 hover:text-gray-600 transition-colors"
          >
            <ChevronLeft size={16} />
            Back
          </button>
          <span className="text-xs font-medium text-gray-400">
            {screen + 1} of {TOTAL_SCREENS}
          </span>
          <div className="w-12" />
        </div>
      </div>

      {/* Screen content */}
      <div className="flex-1 overflow-y-auto px-4 py-6">{renderScreen()}</div>
    </div>
  );
}
