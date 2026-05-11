import { useState } from 'react';
import { useNavigate, useLocation, useSearchParams } from 'react-router-dom';
import { ChevronLeft, ChevronRight, CheckCircle2, Check } from 'lucide-react';
import {
  SmoothExitNextStep,
  SmoothExitPaymentOption,
  NEXT_STEP_LABELS,
  nextStepQualifiesForBridge,
  calcSmoothExitFee,
} from '../../data/mockSmoothExit';
import { api } from '../../api/client';

// ─── Types ─────────────────────────────────────────────────────────────────────

type SurveyData = {
  nextStep: SmoothExitNextStep | '';
  estimatedSalePrice: string;
  moveOutDate: string;
  moverPreference: string;
  wantsDeepClean: boolean;
  utilities: string[];
  notes: string;
};

const EMPTY: SurveyData = {
  nextStep: '',
  estimatedSalePrice: '',
  moveOutDate: '',
  moverPreference: '',
  wantsDeepClean: false,
  utilities: [],
  notes: '',
};

const UTILITY_OPTIONS = [
  'Electric', 'Natural Gas', 'Water / Sewer', 'Internet',
  'Cable / Streaming', 'Trash & Recycling', 'Home Security',
];

const TOTAL_SCREENS = 4;

// ─── Shared UI ─────────────────────────────────────────────────────────────────

function Question({ text, note }: { text: string; note?: string }) {
  return (
    <div className="mb-7 text-center">
      <h2 className="text-2xl font-bold leading-snug text-brand-navy">{text}</h2>
      {note && <p className="mt-2 text-sm text-gray-400">{note}</p>}
    </div>
  );
}

function OptionBtn({
  label, sub, selected, onClick,
}: { label: string; sub?: string; selected?: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={[
        'w-full rounded-xl px-4 py-3.5 text-left transition-all active:scale-[0.98]',
        selected ? 'bg-brand-navy text-white' : 'bg-gray-100 text-brand-navy hover:bg-gray-200',
      ].join(' ')}
    >
      <div className="font-bold text-sm">{label}</div>
      {sub && (
        <div className={['text-xs mt-0.5', selected ? 'text-white/60' : 'text-gray-400'].join(' ')}>
          {sub}
        </div>
      )}
    </button>
  );
}

// ─── Screen 0: What's Next ─────────────────────────────────────────────────────

function WhatsNextScreen({ data, onChange, onNext }: {
  data: SurveyData;
  onChange: (k: keyof SurveyData, v: string) => void;
  onNext: () => void;
}) {
  const options: { value: SmoothExitNextStep; label: string; sub?: string }[] = [
    { value: 'buying_local', label: 'Buying another home nearby' },
    { value: 'buying_out_of_state', label: 'Buying out of state', sub: "We can still help you bridge the gap" },
    { value: 'downsizing', label: 'Downsizing to a smaller home' },
    { value: 'renting', label: 'Renting next' },
    { value: 'retirement', label: 'Moving to a retirement / 55+ community' },
    { value: 'family', label: 'Moving in with family' },
    { value: 'not_sure', label: "Not sure yet" },
  ];

  const qualifies = data.nextStep ? nextStepQualifiesForBridge(data.nextStep as SmoothExitNextStep) : null;

  return (
    <div className="screen-enter flex flex-col items-center">
      <Question text="What comes after this sale?" note="This helps us tailor your Smooth Exit plan" />
      <div className="w-full max-w-sm space-y-2">
        {options.map((o) => (
          <OptionBtn
            key={o.value}
            label={o.label}
            sub={o.sub}
            selected={data.nextStep === o.value}
            onClick={() => onChange('nextStep', o.value)}
          />
        ))}

        {qualifies !== null && (
          <div className={[
            'mt-3 rounded-xl px-4 py-3 text-sm leading-relaxed',
            qualifies
              ? 'bg-purple-50 border border-purple-200 text-purple-800'
              : 'bg-gray-50 border border-gray-200 text-gray-500',
          ].join(' ')}>
            {qualifies
              ? '✅ You qualify for Buy Before You Sell — we\'ll cover that in your concierge intro call.'
              : "We'll focus on your move-out coordination and closing support."}
          </div>
        )}

        <button
          onClick={onNext}
          disabled={!data.nextStep}
          className={[
            'mt-2 flex w-full items-center justify-center gap-2 rounded-xl py-4 text-base font-bold transition-all',
            data.nextStep
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

// ─── Screen 1: Sale Price ──────────────────────────────────────────────────────

function SalePriceScreen({ data, onChange, onNext }: {
  data: SurveyData;
  onChange: (k: keyof SurveyData, v: string) => void;
  onNext: () => void;
}) {
  const price = parseFloat(data.estimatedSalePrice.replace(/,/g, '')) || 0;
  const fee = price > 0 ? calcSmoothExitFee(price) : null;

  return (
    <div className="screen-enter flex flex-col items-center">
      <Question
        text="What's your estimated sale price?"
        note="Used to calculate your Smooth Exit fee — you pay nothing today"
      />
      <div className="w-full max-w-sm space-y-4">
        <div className="relative">
          <span className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400 font-semibold">$</span>
          <input
            type="number"
            value={data.estimatedSalePrice}
            onChange={(e) => onChange('estimatedSalePrice', e.target.value)}
            placeholder="385,000"
            className="w-full rounded-xl border border-gray-200 bg-gray-50 py-3 pl-8 pr-4 text-sm text-gray-800 outline-none focus:border-brand-navy/30 focus:ring-2 focus:ring-brand-navy/10"
          />
        </div>

        {fee !== null && (
          <div className="rounded-xl bg-purple-50 border border-purple-100 px-4 py-3">
            <div className="text-xs text-purple-600 font-semibold uppercase tracking-wide mb-1">
              Your Smooth Exit fee
            </div>
            <div className="text-2xl font-black text-purple-800">
              ${fee.toLocaleString()}
            </div>
            <div className="text-xs text-purple-500 mt-0.5">
              Deducted from your proceeds at closing — nothing out of pocket
            </div>
          </div>
        )}

        <div>
          <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-gray-400">
            Target move-out date
          </label>
          <input
            type="date"
            value={data.moveOutDate}
            onChange={(e) => onChange('moveOutDate', e.target.value)}
            className="w-full rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-800 outline-none focus:border-brand-navy/30 focus:ring-2 focus:ring-brand-navy/10"
          />
        </div>

        <button
          onClick={onNext}
          disabled={!data.estimatedSalePrice}
          className={[
            'flex w-full items-center justify-center gap-2 rounded-xl py-4 text-base font-bold transition-all',
            data.estimatedSalePrice
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

// ─── Screen 2: Move-Out Preferences ───────────────────────────────────────────

function MoveOutScreen({ data, onChange, onToggleUtility, onNext }: {
  data: SurveyData;
  onChange: (k: keyof SurveyData, v: string | boolean) => void;
  onToggleUtility: (u: string) => void;
  onNext: () => void;
}) {
  const movers = [
    { value: 'coordinate', label: 'Coordinate movers for me', sub: 'Included in Smooth Exit' },
    { value: 'booked', label: "I've already booked movers" },
    { value: 'self', label: "I'm handling it myself" },
  ];

  return (
    <div className="screen-enter flex flex-col items-center">
      <Question text="Let's plan your move-out" />
      <div className="w-full max-w-sm space-y-5">
        {/* Movers */}
        <div>
          <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-gray-400">Moving company</div>
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

        {/* Deep clean */}
        <button
          onClick={() => onChange('wantsDeepClean', !data.wantsDeepClean)}
          className={[
            'flex w-full items-center gap-3 rounded-xl border-2 px-4 py-3.5 transition-all',
            data.wantsDeepClean ? 'border-purple-400 bg-purple-50' : 'border-gray-100 bg-white hover:border-gray-200',
          ].join(' ')}
        >
          <div className={[
            'flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full border-2 transition-all',
            data.wantsDeepClean ? 'border-purple-500 bg-purple-500' : 'border-gray-200',
          ].join(' ')}>
            {data.wantsDeepClean && <Check size={12} className="text-white" strokeWidth={3} />}
          </div>
          <div className="text-left">
            <div className="text-sm font-semibold text-brand-navy">Move-out deep clean</div>
            <div className="text-xs text-gray-400">We schedule a professional clean after you move out</div>
          </div>
        </button>

        {/* Utilities to cancel */}
        <div>
          <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-gray-400">
            Utilities to cancel
          </div>
          <div className="space-y-2">
            {UTILITY_OPTIONS.map((u) => {
              const selected = data.utilities.includes(u);
              return (
                <button
                  key={u}
                  onClick={() => onToggleUtility(u)}
                  className={[
                    'flex w-full items-center gap-3 rounded-xl px-4 py-3 transition-all active:scale-[0.98]',
                    selected ? 'bg-brand-navy text-white' : 'bg-gray-100 text-brand-navy hover:bg-gray-200',
                  ].join(' ')}
                >
                  <div className={[
                    'flex h-5 w-5 flex-shrink-0 items-center justify-center rounded border-2 transition-all',
                    selected ? 'border-white bg-white' : 'border-gray-300 bg-white',
                  ].join(' ')}>
                    {selected && <Check size={11} className="text-brand-navy" strokeWidth={3} />}
                  </div>
                  <span className="text-sm font-semibold">{u}</span>
                </button>
              );
            })}
          </div>
          <p className="mt-2 text-center text-xs text-gray-400">Select all you want us to handle — or skip if managing yourself</p>
        </div>

        <button
          onClick={onNext}
          disabled={!data.moverPreference}
          className={[
            'flex w-full items-center justify-center gap-2 rounded-xl py-4 text-base font-bold transition-all',
            data.moverPreference
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

// ─── Screen 3: Confirmation ────────────────────────────────────────────────────

const PAYMENT_OPTIONS: { value: SmoothExitPaymentOption; title: string; badge: string; badgeStyle: string; desc: string }[] = [
  {
    value: 'from_proceeds',
    title: 'From my sale proceeds',
    badge: 'Most common',
    badgeStyle: 'bg-purple-500 text-white',
    desc: 'Deducted at closing — you never write a check.',
  },
  {
    value: 'buyer_concession',
    title: 'Buyer concession',
    badge: 'Ask your agent',
    badgeStyle: 'bg-gray-100 text-gray-500',
    desc: 'Negotiate the fee into the contract — buyer pays at closing.',
  },
];

function ConfirmScreen({ data, submitting, onSubmit }: {
  data: SurveyData;
  submitting?: boolean;
  onSubmit: (paymentOption: SmoothExitPaymentOption) => void;
}) {
  const [paymentOption, setPaymentOption] = useState<SmoothExitPaymentOption | null>(null);
  const price = parseFloat(data.estimatedSalePrice) || 0;
  const fee = calcSmoothExitFee(price);
  const qualifies = data.nextStep ? nextStepQualifiesForBridge(data.nextStep as SmoothExitNextStep) : false;

  return (
    <div className="screen-enter flex flex-col items-center">
      <Question text="Review your Smooth Exit plan" note="Your concierge will reach out within 24 hours" />
      <div className="w-full max-w-sm space-y-4">
        {/* Summary */}
        <div className="rounded-2xl bg-white shadow-sm divide-y divide-gray-50 overflow-hidden">
          <div className="px-4 py-3">
            <div className="text-xs text-gray-400 font-medium">What's next</div>
            <div className="text-sm font-semibold text-brand-navy mt-0.5">
              {data.nextStep ? NEXT_STEP_LABELS[data.nextStep as SmoothExitNextStep] : '—'}
            </div>
          </div>
          {data.moveOutDate && (
            <div className="px-4 py-3">
              <div className="text-xs text-gray-400 font-medium">Target move-out</div>
              <div className="text-sm font-semibold text-brand-navy mt-0.5">
                {new Date(data.moveOutDate).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}
              </div>
            </div>
          )}
          {data.utilities.length > 0 && (
            <div className="px-4 py-3">
              <div className="text-xs text-gray-400 font-medium">Utilities to cancel ({data.utilities.length})</div>
              <div className="text-sm text-brand-navy mt-0.5">{data.utilities.join(', ')}</div>
            </div>
          )}
        </div>

        {/* Bridge financing callout */}
        {qualifies && (
          <div className="rounded-xl bg-purple-50 border border-purple-200 px-4 py-3">
            <div className="flex items-center gap-2 mb-1">
              <span className="text-base">🏡</span>
              <span className="text-sm font-bold text-purple-800">Buy Before You Sell — included</span>
            </div>
            <p className="text-xs text-purple-600 leading-relaxed">
              Your concierge will schedule a call to walk through your equity position and bridge financing options.
            </p>
          </div>
        )}

        {/* Fee */}
        <div className="rounded-2xl bg-white shadow-sm overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b border-gray-50">
            <span className="text-sm text-gray-600">Estimated sale price</span>
            <span className="text-sm font-semibold text-brand-navy">${price.toLocaleString()}</span>
          </div>
          <div className="flex items-center justify-between px-4 py-3 bg-gray-50">
            <span className="text-sm font-bold text-brand-navy">Smooth Exit fee (1%)</span>
            <span className="text-base font-black text-brand-navy">${fee.toLocaleString()}</span>
          </div>
        </div>

        {/* Payment */}
        <div>
          <div className="mb-2 text-xs font-bold uppercase tracking-wider text-gray-400">How would you like to pay?</div>
          <div className="space-y-2">
            {PAYMENT_OPTIONS.map((opt) => {
              const isSelected = paymentOption === opt.value;
              return (
                <button
                  key={opt.value}
                  onClick={() => setPaymentOption(opt.value)}
                  className={[
                    'w-full rounded-xl border-2 p-4 text-left transition-all active:scale-[0.99]',
                    isSelected ? 'border-purple-500 bg-purple-50' : 'border-gray-100 bg-white hover:border-gray-200',
                  ].join(' ')}
                >
                  <div className="flex items-center justify-between mb-1">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-bold text-brand-navy">{opt.title}</span>
                      <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-bold ${opt.badgeStyle}`}>
                        {opt.badge}
                      </span>
                    </div>
                    <div className={[
                      'flex h-5 w-5 items-center justify-center rounded-full border-2 transition-all',
                      isSelected ? 'border-purple-500 bg-purple-500' : 'border-gray-200',
                    ].join(' ')}>
                      {isSelected && <Check size={10} className="text-white" strokeWidth={3} />}
                    </div>
                  </div>
                  <p className="text-xs text-gray-400">{opt.desc}</p>
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
              ? 'bg-purple-700 text-white hover:bg-purple-800 active:scale-[0.98]'
              : 'cursor-not-allowed bg-gray-100 text-gray-300',
          ].join(' ')}
        >
          {submitting ? 'Processing…' : 'Submit Request'} <ChevronRight size={18} />
        </button>
      </div>
    </div>
  );
}

// ─── Submitted ─────────────────────────────────────────────────────────────────

function SubmittedScreen({ data, paymentOption, fromOnboarding }: { data: SurveyData; paymentOption: SmoothExitPaymentOption; fromOnboarding: boolean }) {
  const navigate = useNavigate();
  const qualifies = data.nextStep ? nextStepQualifiesForBridge(data.nextStep as SmoothExitNextStep) : false;

  return (
    <div className="screen-enter flex flex-col items-center py-8 text-center">
      <div className="mb-5 flex h-16 w-16 items-center justify-center rounded-2xl bg-purple-100">
        <CheckCircle2 size={34} className="text-purple-500" />
      </div>
      <h2 className="text-3xl font-black text-brand-navy">Smooth Exit activated!</h2>
      <p className="mt-3 max-w-sm text-sm leading-relaxed text-gray-500">
        {qualifies
          ? 'Your concierge will reach out within 24 hours to walk through your Buy Before You Sell options and get your move-out coordination started.'
          : 'Your concierge will reach out within 24 hours to get your move-out coordination and closing support underway.'}
      </p>
      <div className="mt-4 rounded-xl border border-purple-200 bg-purple-50 px-5 py-3 text-sm text-purple-800">
        <span className="font-semibold">
          {paymentOption === 'from_proceeds' ? 'Fee deducted at closing' : 'Fee via buyer concession'}
        </span>
        {' — '}nothing due today.
      </div>
      <button
        onClick={() => {
          if (fromOnboarding) sessionStorage.setItem('seller_welcomed', '1');
          navigate('/');
        }}
        className="mt-8 flex items-center gap-2 rounded-xl bg-purple-700 px-8 py-4 text-base font-bold text-white hover:bg-purple-800 transition-all active:scale-[0.98]"
      >
        Go to my dashboard <ChevronRight size={18} />
      </button>
    </div>
  );
}

// ─── Main ─────────────────────────────────────────────────────────────────────

export default function SmoothExitSurvey() {
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const fromOnboarding = searchParams.get('fromOnboarding') === 'true';
  const locationState = location.state as { dealId?: string | null } | null;
  const dealId = locationState?.dealId ?? null;
  const [screen, setScreen] = useState(0);
  const [data, setData] = useState<SurveyData>(EMPTY);
  const [submitted, setSubmitted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [chosenPayment, setChosenPayment] = useState<SmoothExitPaymentOption>('from_proceeds');

  const progress = Math.min(((screen + 1) / TOTAL_SCREENS) * 100, 100);

  function set<K extends keyof SurveyData>(key: K, val: SurveyData[K]) {
    setData((d) => ({ ...d, [key]: val }));
  }

  function toggleUtility(u: string) {
    setData((d) => ({
      ...d,
      utilities: d.utilities.includes(u)
        ? d.utilities.filter((x) => x !== u)
        : [...d.utilities, u],
    }));
  }

  function next() { setScreen((s) => Math.min(s + 1, TOTAL_SCREENS - 1)); }
  function back() {
    if (screen === 0) {
      if (fromOnboarding) navigate('/smooth-exit?fromOnboarding=true');
      else navigate(-1);
    } else {
      setScreen((s) => Math.max(s - 1, 0));
    }
  }

  if (submitted) {
    return (
      <div className="flex min-h-screen flex-col bg-white px-4 py-8">
        <SubmittedScreen data={data} paymentOption={chosenPayment} fromOnboarding={fromOnboarding} />
      </div>
    );
  }

  function renderScreen() {
    switch (screen) {
      case 0:
        return <WhatsNextScreen data={data} onChange={(k, v) => set(k, v as SurveyData[typeof k])} onNext={next} />;
      case 1:
        return <SalePriceScreen data={data} onChange={(k, v) => set(k, v as SurveyData[typeof k])} onNext={next} />;
      case 2:
        return (
          <MoveOutScreen
            data={data}
            onChange={(k, v) => set(k, v as SurveyData[typeof k])}
            onToggleUtility={toggleUtility}
            onNext={next}
          />
        );
      case 3:
        return (
          <ConfirmScreen
            data={data}
            submitting={submitting}
            onSubmit={async (opt) => {
              setChosenPayment(opt);
              if (dealId) {
                setSubmitting(true);
                try {
                  const price = parseFloat(data.estimatedSalePrice) || 0;
                  await api.post(`/deals/${dealId}/smoothexit`, {
                    payment_option: opt,
                    estimated_sale_price: Math.round(price),
                    fee_cents: Math.round(price * 0.01 * 100),
                    survey_answers: data,
                  });
                } catch {
                  // fall through to show submitted screen
                } finally {
                  setSubmitting(false);
                }
              }
              setSubmitted(true);
            }}
          />
        );
      default:
        return null;
    }
  }

  return (
    <div className="flex min-h-screen flex-col bg-white">
      {/* Progress */}
      <div className="sticky top-0 z-10 bg-white">
        <div className="h-1 w-full bg-gray-100">
          <div className="h-1 bg-purple-600 transition-all duration-300" style={{ width: `${progress}%` }} />
        </div>
        <div className="flex items-center justify-between px-4 py-3">
          <button onClick={back} className="flex items-center gap-1 text-sm text-gray-400 hover:text-gray-600 transition-colors">
            <ChevronLeft size={16} /> Back
          </button>
          <span className="text-xs font-medium text-gray-400">{screen + 1} of {TOTAL_SCREENS}</span>
          <div className="w-12" />
        </div>
      </div>
      <div className="flex-1 overflow-y-auto px-4 py-6">{renderScreen()}</div>
    </div>
  );
}
