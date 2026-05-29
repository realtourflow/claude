"use client";

import { useState, useEffect } from 'react';
import { useRouter } from "next/navigation";
import {
  ChevronRight, Check, CheckCircle2, ArrowRight,
  User, Building2, Users, MessageSquare, Zap,
  FileText, Upload, Trash2,
} from 'lucide-react';
import { DocType, DOC_TYPE_LABELS } from "@/hooks/useAgentDocs";
import OnboardingLayout from './OnboardingLayout';
import { useAgentSetupStore } from "@/lib/store/agentSetupStore";
import { api } from "@/lib/api-client";
import { useAuthStore } from "@/lib/store/authStore";
import { uploadAgentPhoto } from "@/hooks/useAgentPhoto";
import { useAgentDocs } from "@/hooks/useAgentDocs";

// ─── Types ────────────────────────────────────────────────────────────────────

type LenderChoice = 'mountain' | 'other';

type AgentSetupData = {
  name: string;
  title: string;
  phone: string;
  licenseNumber: string;
  photoUrl: string;
  bio: string;
  brokerage: string;
  brokerageAddress: string;
  tcName: string;
  tcEmail: string;
  tcPhone: string;
  tcLinkedUserId: string;
  buyerMessage: string;
  sellerMessage: string;
  lenderChoice: LenderChoice | '';
  otherLenderName: string;
  notifDealStage: boolean;
  notifClientMsg: boolean;
  notifOverdue: boolean;
  notifDisclosures: boolean;
  notifFastPass: boolean;
  toolDocuSign: boolean;
  toolGoogleCal: boolean;
  toolOutlook: boolean;
  toolDotloop: boolean;
  toolSkyslope: boolean;
  toolZapier: boolean;
  buyerCommissionIsPct: boolean;
  buyerCommissionPct: number;
  buyerCommissionAmount: number;
  sellerCommissionIsPct: boolean;
  sellerCommissionPct: number;
  sellerCommissionAmount: number;
};

const DEFAULT_BUYER_MSG =
  `Hi [ClientName], I'm thrilled to help you find your new home! I've set up your personal portal — it's your one-stop shop to track everything from search through closing. Your first step is to complete the intake questionnaire so I can start finding properties that fit you perfectly. Don't hesitate to reach out anytime. Let's find you a home!`;

const DEFAULT_SELLER_MSG =
  `Hi [ClientName], thank you for trusting me to sell your home! I've set up your seller portal where we'll manage everything from listing prep through closing day. Please complete the intake questionnaire when you get a chance — it helps me build your pricing strategy. I'll be in touch soon to schedule your listing strategy call. Excited to get started!`;

const EMPTY: AgentSetupData = {
  name: '', title: '', phone: '', licenseNumber: '', photoUrl: '', bio: '',
  brokerage: '', brokerageAddress: '', tcName: '', tcEmail: '', tcPhone: '', tcLinkedUserId: '',
  buyerMessage: DEFAULT_BUYER_MSG, sellerMessage: DEFAULT_SELLER_MSG,
  lenderChoice: '', otherLenderName: '',
  notifDealStage: true, notifClientMsg: true, notifOverdue: true,
  notifDisclosures: true, notifFastPass: true,
  buyerCommissionIsPct: true, buyerCommissionPct: 3, buyerCommissionAmount: 0,
  sellerCommissionIsPct: true, sellerCommissionPct: 3, sellerCommissionAmount: 0,
  toolDocuSign: false, toolGoogleCal: false, toolOutlook: false,
  toolDotloop: false, toolSkyslope: false, toolZapier: false,
};

// ─── Constants ────────────────────────────────────────────────────────────────

const TOTAL_STEPS = 13; // screens 1–13; 0 = welcome, 14 = done

const STEP_LABELS: Record<number, string> = {
  1:  'Step 1 of 13 · Your Profile',
  2:  'Step 2 of 13 · Your Profile',
  3:  'Step 3 of 13 · Your Profile',
  4:  'Step 4 of 13 · Your Profile',
  5:  'Step 5 of 13 · Your Profile',
  6:  'Step 6 of 13 · Brokerage',
  7:  'Step 7 of 13 · Your Team',
  8:  'Step 8 of 13 · Client Experience',
  9:  'Step 9 of 13 · Preferences',
  10: 'Step 10 of 13 · Preferences',
  11: 'Step 11 of 13 · Integrations',
  12: 'Step 12 of 13 · Documents',
  13: 'Step 13 of 13 · Commission Defaults',
};

const TITLE_OPTIONS = [
  'Realtor', 'Senior Agent', 'Team Lead',
  'Buyer\'s Agent', 'Listing Specialist', 'Broker', 'Broker/Owner',
];

const BROKERAGE_OPTIONS = [
  'Keller Williams', 'RE/MAX', 'Coldwell Banker', 'eXp Realty',
  'Compass', 'Century 21', 'Berkshire Hathaway HomeServices',
  'Independent', 'Other',
];

const INTEGRATION_TOOLS: {
  key: keyof AgentSetupData;
  name: string;
  logo: string;
  desc: string;
}[] = [
  { key: 'toolDocuSign',  name: 'DocuSign',              logo: '📄', desc: 'E-signatures for contracts and disclosures' },
  { key: 'toolGoogleCal', name: 'Google Calendar',       logo: '📅', desc: 'Sync closing dates and task deadlines' },
  { key: 'toolOutlook',   name: 'Outlook / Office 365',  logo: '📆', desc: 'Calendar sync for Microsoft users' },
  { key: 'toolDotloop',   name: 'Dotloop',               logo: '🔄', desc: 'Transaction management and document storage' },
  { key: 'toolSkyslope',  name: 'Skyslope',              logo: '🏠', desc: 'Compliance and file management' },
  { key: 'toolZapier',    name: 'Zapier',                logo: '⚡', desc: 'Connect RealTourFlow to 5,000+ apps' },
];

const NOTIF_ITEMS: { key: keyof AgentSetupData; label: string; sub: string }[] = [
  { key: 'notifDealStage',    label: 'Deal stage changes',       sub: 'When a deal advances or falls back a stage' },
  { key: 'notifClientMsg',    label: 'New client messages',      sub: 'When a client sends a message through the portal' },
  { key: 'notifOverdue',      label: 'Overdue task alerts',      sub: 'Daily reminder for tasks past their due date' },
  { key: 'notifDisclosures',  label: 'Disclosure reminders',     sub: 'When disclosures are unsigned for 48+ hours' },
  { key: 'notifFastPass',     label: 'Fast Pass enrollments',    sub: 'When a client enrolls in Fast Pass' },
];

// ─── Shared UI ────────────────────────────────────────────────────────────────

function Question({ text, note }: { text: string; note?: string }) {
  return (
    <div className="mb-8 text-center">
      <h2 className="text-2xl font-bold leading-snug text-brand-navy sm:text-3xl">{text}</h2>
      {note && <p className="mt-2 text-sm text-gray-400">{note}</p>}
    </div>
  );
}

function ContinueBtn({
  onClick, disabled = false, label = 'Continue',
}: { onClick: () => void; disabled?: boolean; label?: string }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={[
        'mt-6 flex w-full items-center justify-center gap-2 rounded-xl py-4 text-base font-bold transition-all',
        disabled
          ? 'cursor-not-allowed bg-gray-100 text-gray-300'
          : 'bg-brand-navy text-white hover:bg-brand-navy/80 active:scale-[0.98]',
      ].join(' ')}
    >
      {label} <ChevronRight size={18} />
    </button>
  );
}

function SkipLink({ onClick, label = 'Skip for now' }: { onClick: () => void; label?: string }) {
  return (
    <button
      onClick={onClick}
      className="mt-3 block w-full text-center text-sm text-gray-400 hover:text-gray-600 transition-colors"
    >
      {label}
    </button>
  );
}

function OptionBtn({ label, selected, onClick }: { label: string; selected?: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={[
        'w-full rounded-xl py-4 text-center text-base font-bold transition-all active:scale-[0.98]',
        selected ? 'bg-brand-navy text-white' : 'bg-gray-100 text-brand-navy hover:bg-gray-200',
      ].join(' ')}
    >
      {label}
    </button>
  );
}

// ─── Screen 0: Welcome ────────────────────────────────────────────────────────

function WelcomeScreen({ onStart, onSkip }: { onStart: () => void; onSkip: () => void }) {
  const steps = [
    { icon: <User size={15} />,         label: 'Profile & headshot' },
    { icon: <Building2 size={15} />,    label: 'Brokerage' },
    { icon: <Users size={15} />,        label: 'Transaction Coordinator' },
    { icon: <MessageSquare size={15} />,label: 'Client welcome messages' },
    { icon: <Zap size={15} />,          label: 'Preferences & integrations' },
  ];

  return (
    <div className="flex flex-col items-center text-center">
      <div className="mb-5 flex h-16 w-16 items-center justify-center rounded-2xl bg-brand-navy text-white text-2xl font-black">
        R
      </div>
      <h1 className="text-3xl font-black text-brand-navy leading-tight">
        Welcome to RealTour Flow
      </h1>
      <p className="mt-3 max-w-sm text-sm text-gray-500 leading-relaxed">
        Let&apos;s build your office in about 3 minutes. You&apos;ll only do this once — every setting here saves time on every deal you open.
      </p>

      {/* What we'll set up */}
      <div className="mt-7 w-full max-w-xs rounded-2xl bg-gray-50 px-5 py-4 text-left space-y-2.5">
        {steps.map(({ icon, label }) => (
          <div key={label} className="flex items-center gap-3 text-sm text-gray-600">
            <span className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-white shadow-sm text-brand-navy">
              {icon}
            </span>
            {label}
          </div>
        ))}
      </div>

      <button
        onClick={onStart}
        className="mt-7 flex w-full max-w-xs items-center justify-center gap-2 rounded-xl bg-brand-navy py-4 text-base font-bold text-white hover:bg-brand-navy/80 active:scale-[0.98] transition-all"
      >
        Let&apos;s build my office <ArrowRight size={18} />
      </button>

      <button
        onClick={onSkip}
        className="mt-4 text-sm text-gray-300 hover:text-gray-500 transition-colors"
      >
        I&apos;ll finish this later →
      </button>
    </div>
  );
}

// ─── Screen 1: Full Name ──────────────────────────────────────────────────────

function NameScreen({ value, onChange, onContinue }: {
  value: string; onChange: (v: string) => void; onContinue: () => void;
}) {
  return (
    <div className="flex flex-col items-center">
      <Question text="What's your name?" note="This is how you'll appear to clients in the portal" />
      <div className="w-full max-w-sm">
        <input
          autoFocus
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="e.g. Sarah Johnson"
          className="w-full rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-800 outline-none focus:border-brand-navy/30 focus:ring-2 focus:ring-brand-navy/10"
        />
        <ContinueBtn onClick={onContinue} disabled={!value.trim()} />
      </div>
    </div>
  );
}

// ─── Screen 2: Title ──────────────────────────────────────────────────────────

function TitleScreen({ onSelect }: { onSelect: (v: string) => void }) {
  return (
    <div className="flex flex-col items-center">
      <Question text="What's your title?" />
      <div className="w-full max-w-xs space-y-2.5">
        {TITLE_OPTIONS.map((t) => (
          <OptionBtn key={t} label={t} onClick={() => onSelect(t)} />
        ))}
      </div>
    </div>
  );
}

// ─── Screen 3: Phone + License ────────────────────────────────────────────────

function PhoneLicenseScreen({
  phone, license, onChangePhone, onChangeLicense, onContinue,
}: {
  phone: string; license: string;
  onChangePhone: (v: string) => void; onChangeLicense: (v: string) => void;
  onContinue: () => void;
}) {
  return (
    <div className="flex flex-col items-center">
      <Question text="Contact & credentials" note="Used in your profile and shown to clients" />
      <div className="w-full max-w-sm space-y-3">
        <div>
          <label className="mb-1 block text-xs font-semibold uppercase tracking-wider text-gray-400">
            Phone number
          </label>
          <input
            type="tel"
            value={phone}
            onChange={(e) => onChangePhone(e.target.value)}
            placeholder="(205) 555-0100"
            className="w-full rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-800 outline-none focus:border-brand-navy/30 focus:ring-2 focus:ring-brand-navy/10"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-semibold uppercase tracking-wider text-gray-400">
            License number
          </label>
          <input
            type="text"
            value={license}
            onChange={(e) => onChangeLicense(e.target.value)}
            placeholder="e.g. AL-092341"
            className="w-full rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-800 outline-none focus:border-brand-navy/30 focus:ring-2 focus:ring-brand-navy/10"
          />
        </div>
        <ContinueBtn onClick={onContinue} disabled={!phone.trim()} />
      </div>
    </div>
  );
}

// ─── Screen 4: Profile Photo ──────────────────────────────────────────────────

function PhotoScreen({
  selected, name, onSelect, onContinue, onSkip,
}: {
  selected: string; name: string; onSelect: (url: string) => void;
  onContinue: () => void; onSkip: () => void;
}) {
  const [uploading, setUploading] = useState(false);
  const [err, setErr] = useState('');

  const initials = (name || '?')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((s) => s[0]?.toUpperCase() ?? '')
    .join('') || '?';

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) {
      setErr('Image is too large — max 5 MB.');
      return;
    }
    setErr('');
    setUploading(true);
    try {
      const url = await uploadAgentPhoto(file);
      onSelect(url);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not process that image.');
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="flex flex-col items-center">
      <Question
        text="Add your headshot"
        note="Clients see this in their portal. Upload a photo from your device."
      />
      <div className="w-full max-w-sm flex flex-col items-center">
        {/* Preview */}
        <div className="mb-5 flex h-32 w-32 items-center justify-center">
          {selected ? (
            <img
              src={selected}
              alt="Your headshot"
              className="h-32 w-32 rounded-2xl object-cover ring-2 ring-brand-navy/10 shadow-sm"
            />
          ) : (
            <div className="flex h-32 w-32 items-center justify-center rounded-2xl bg-brand-navy/10 ring-2 ring-brand-navy/10 text-3xl font-bold text-brand-navy">
              {initials}
            </div>
          )}
        </div>

        {/* Upload */}
        <label className="mb-2 flex w-full cursor-pointer items-center justify-center gap-2 rounded-xl border-2 border-dashed border-gray-200 bg-gray-50 px-4 py-4 text-sm font-semibold text-brand-navy hover:border-brand-navy/30 hover:bg-white transition-colors">
          <Upload size={16} />
          {uploading ? 'Uploading…' : selected ? 'Choose a different photo' : 'Upload from your device'}
          <input
            type="file"
            accept="image/*"
            className="hidden"
            onChange={handleFile}
            disabled={uploading}
          />
        </label>
        <p className="mb-4 text-[11px] text-gray-400">JPG or PNG · up to 5 MB</p>
        {err && <p className="mb-3 text-xs text-red-500 text-center">{err}</p>}

        <div className="w-full">
          <ContinueBtn onClick={onContinue} disabled={!selected} />
          <SkipLink onClick={onSkip} />
        </div>
      </div>
    </div>
  );
}

// ─── Screen 5: Bio ────────────────────────────────────────────────────────────

function BioScreen({
  value, onChange, onContinue, onSkip,
}: {
  value: string; onChange: (v: string) => void; onContinue: () => void; onSkip: () => void;
}) {
  return (
    <div className="flex flex-col items-center">
      <Question
        text="Write a quick intro"
        note="Shown to clients in their portal — a short paragraph about you works great"
      />
      <div className="w-full max-w-sm">
        <textarea
          autoFocus
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="e.g. I've been helping Birmingham families buy and sell homes for 8 years. My focus is on clear communication, stress-free transactions, and getting you to closing on time."
          rows={5}
          className="w-full rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-800 outline-none focus:border-brand-navy/30 focus:ring-2 focus:ring-brand-navy/10 resize-none"
        />
        <ContinueBtn onClick={onContinue} />
        <SkipLink onClick={onSkip} />
      </div>
    </div>
  );
}

// ─── Screen 6: Brokerage ─────────────────────────────────────────────────────

function BrokerageScreen({
  onSelect,
}: {
  onSelect: (name: string, address: string) => void;
}) {
  const [otherSelected, setOtherSelected] = useState(false);
  const [customName, setCustomName] = useState('');
  const [customAddress, setCustomAddress] = useState('');

  const namedOptions = BROKERAGE_OPTIONS.filter((b) => b !== 'Other');

  return (
    <div className="flex flex-col items-center">
      <Question text="What brokerage are you with?" />
      <div className="w-full max-w-xs space-y-2.5">
        {/* Named brokerages — auto-advance */}
        {namedOptions.map((b) => (
          <OptionBtn
            key={b}
            label={b}
            selected={false}
            onClick={() => onSelect(b, '')}
          />
        ))}

        {/* Other — expands inline form */}
        <button
          onClick={() => setOtherSelected(true)}
          className={[
            'w-full rounded-xl py-4 text-center text-base font-bold transition-all active:scale-[0.98]',
            otherSelected
              ? 'bg-brand-navy text-white'
              : 'bg-gray-100 text-brand-navy hover:bg-gray-200',
          ].join(' ')}
        >
          Other
        </button>

        {/* Inline expansion for Other */}
        {otherSelected && (
          <div className="rounded-xl border border-brand-navy/20 bg-brand-navy/5 px-4 py-4 space-y-3">
            <div>
              <label className="mb-1 block text-xs font-semibold uppercase tracking-wider text-gray-400">
                Brokerage name <span className="text-red-400">*</span>
              </label>
              <input
                autoFocus
                type="text"
                value={customName}
                onChange={(e) => setCustomName(e.target.value)}
                placeholder="e.g. River City Realty"
                className="w-full rounded-xl border border-gray-200 bg-white px-4 py-2.5 text-sm text-gray-800 outline-none focus:border-brand-navy/30 focus:ring-2 focus:ring-brand-navy/10"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold uppercase tracking-wider text-gray-400">
                Office address <span className="font-normal normal-case text-gray-300">(optional)</span>
              </label>
              <input
                type="text"
                value={customAddress}
                onChange={(e) => setCustomAddress(e.target.value)}
                placeholder="e.g. 100 Riverchase Pkwy, Hoover, AL 35244"
                className="w-full rounded-xl border border-gray-200 bg-white px-4 py-2.5 text-sm text-gray-800 outline-none focus:border-brand-navy/30 focus:ring-2 focus:ring-brand-navy/10"
              />
            </div>
            <ContinueBtn
              onClick={() => onSelect(customName.trim(), customAddress.trim())}
              disabled={!customName.trim()}
            />
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Screen 7: Transaction Coordinator ───────────────────────────────────────

function TCScreen({
  tcName, tcEmail, tcPhone,
  onChange, onContinue, onSolo,
}: {
  tcName: string; tcEmail: string; tcPhone: string; tcLinkedUserId: string;
  onChange: (field: 'tcName' | 'tcEmail' | 'tcPhone' | 'tcLinkedUserId', val: string) => void;
  onContinue: () => void;
  onSolo: () => void;
}) {
  const [usesTC, setUsesTC] = useState<boolean | null>(null);

  // Step 1: yes / no question
  if (usesTC === null) {
    return (
      <div className="flex flex-col items-center">
        <Question
          text="Do you work with a Transaction Coordinator?"
          note="This determines how tasks and file management are routed on your deals"
        />
        <div className="w-full max-w-xs space-y-3">
          <button
            onClick={() => setUsesTC(true)}
            className="w-full rounded-xl bg-gray-100 py-4 text-center text-base font-bold text-brand-navy hover:bg-gray-200 active:scale-[0.98] transition-all"
          >
            Yes, I work with a TC
          </button>
          <button
            onClick={onSolo}
            className="w-full rounded-xl bg-gray-100 py-4 text-center text-base font-bold text-brand-navy hover:bg-gray-200 active:scale-[0.98] transition-all"
          >
            No, I handle it myself
          </button>
        </div>
        <p className="mt-4 text-xs text-gray-300 text-center max-w-xs">
          You can always add a TC later in Settings
        </p>
      </div>
    );
  }

  // Step 2: TC details form
  return (
    <div className="flex flex-col items-center">
      <Question
        text="Who is your Transaction Coordinator?"
        note="They'll be automatically added to every deal — messages, checklists, and tasks"
      />
      <div className="w-full max-w-sm space-y-3">
        <div>
          <label className="mb-1 block text-xs font-semibold uppercase tracking-wider text-gray-400">Full name</label>
          <input type="text" value={tcName} onChange={(e) => onChange('tcName', e.target.value)}
            placeholder="e.g. Jamie Taylor"
            className="w-full rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-800 outline-none focus:border-brand-navy/30 focus:ring-2 focus:ring-brand-navy/10" />
        </div>
        <div>
          <label className="mb-1 block text-xs font-semibold uppercase tracking-wider text-gray-400">Email</label>
          <input type="email" value={tcEmail} onChange={(e) => onChange('tcEmail', e.target.value)}
            placeholder="jamie@youroffice.com"
            className="w-full rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-800 outline-none focus:border-brand-navy/30 focus:ring-2 focus:ring-brand-navy/10" />
        </div>
        <div>
          <label className="mb-1 block text-xs font-semibold uppercase tracking-wider text-gray-400">
            Phone <span className="font-normal normal-case text-gray-300">(optional)</span>
          </label>
          <input type="tel" value={tcPhone} onChange={(e) => onChange('tcPhone', e.target.value)}
            placeholder="(205) 555-0244"
            className="w-full rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-800 outline-none focus:border-brand-navy/30 focus:ring-2 focus:ring-brand-navy/10" />
        </div>

        <ContinueBtn onClick={onContinue} disabled={!tcName.trim()} />
        <button onClick={() => setUsesTC(null)}
          className="mt-3 block w-full text-center text-sm text-gray-400 hover:text-gray-600 transition-colors">
          ← Back
        </button>
      </div>
    </div>
  );
}

// ─── Screen 8: Welcome Messages ───────────────────────────────────────────────

function WelcomeMessagesScreen({
  buyerMsg, sellerMsg, onBuyerChange, onSellerChange, onContinue,
}: {
  buyerMsg: string; sellerMsg: string;
  onBuyerChange: (v: string) => void; onSellerChange: (v: string) => void;
  onContinue: () => void;
}) {
  const [tab, setTab] = useState<'buyer' | 'seller'>('buyer');

  return (
    <div className="flex flex-col items-center">
      <Question
        text="Write your default welcome messages"
        note='Write once, send to every client. Use [ClientName] as a placeholder — customize per deal anytime.'
      />
      <div className="w-full max-w-sm">
        {/* Tabs */}
        <div className="mb-3 flex rounded-xl bg-gray-100 p-1">
          {(['buyer', 'seller'] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={[
                'flex-1 rounded-lg py-2 text-sm font-semibold transition-all capitalize',
                tab === t ? 'bg-white shadow-sm text-brand-navy' : 'text-gray-400 hover:text-gray-600',
              ].join(' ')}
            >
              {t === 'buyer' ? '🏠 Buyer' : '🔑 Seller'}
            </button>
          ))}
        </div>

        {tab === 'buyer' ? (
          <textarea
            value={buyerMsg}
            onChange={(e) => onBuyerChange(e.target.value)}
            rows={7}
            className="w-full rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-800 outline-none focus:border-brand-navy/30 focus:ring-2 focus:ring-brand-navy/10 resize-none"
          />
        ) : (
          <textarea
            value={sellerMsg}
            onChange={(e) => onSellerChange(e.target.value)}
            rows={7}
            className="w-full rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-800 outline-none focus:border-brand-navy/30 focus:ring-2 focus:ring-brand-navy/10 resize-none"
          />
        )}

        <p className="mt-2 mb-1 text-center text-[11px] text-gray-300">
          Use [ClientName] and it&apos;ll be replaced with the client&apos;s name automatically
        </p>
        <ContinueBtn onClick={onContinue} label="Save messages" />
      </div>
    </div>
  );
}

// ─── Screen 9: Default Lender ─────────────────────────────────────────────────

function LenderScreen({ onSelect }: { onSelect: (v: LenderChoice) => void }) {
  return (
    <div className="flex flex-col items-center">
      <Question
        text="How lenders work in RealTourFlow"
        note="You're free to use any lender — here's what that means for your clients"
      />
      <div className="w-full max-w-md space-y-3">
        {/* Mountain Mortgage — featured */}
        <button
          onClick={() => onSelect('mountain')}
          className="group w-full overflow-hidden rounded-2xl bg-brand-navy p-5 text-left transition-all hover:bg-brand-navy/90 active:scale-[0.99]"
        >
          <div className="mb-1 flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-gold text-brand-navy font-black text-sm">M</div>
            <span className="text-xs font-bold uppercase tracking-widest text-brand-gold">Preferred · Fully Integrated</span>
          </div>
          <div className="mt-2 text-lg font-bold text-white">Mountain Mortgage</div>
          <p className="mt-1 text-sm text-white/70">
            Already wired into RealTourFlow via ARIVE. Your clients see real-time loan milestones in their portal — no more chasing the lender. Disclosures and clear-to-close sync automatically.
          </p>
          <p className="mt-3 text-xs font-semibold text-brand-gold/80 uppercase tracking-wide">
            Use Mountain Mortgage as my preferred lender →
          </p>
        </button>

        {/* Any other lender */}
        <button
          onClick={() => onSelect('other')}
          className="w-full overflow-hidden rounded-2xl border border-gray-200 bg-gray-50 p-5 text-left transition-all hover:bg-gray-100 active:scale-[0.99]"
        >
          <div className="mb-1 flex items-center gap-2">
            <Building2 size={16} className="text-gray-400" />
            <span className="text-xs font-bold uppercase tracking-widest text-gray-400">Any other lender</span>
          </div>
          <div className="mt-2 text-lg font-bold text-gray-700">I&apos;ll use a different lender</div>
          <p className="mt-1 text-sm text-gray-500">
            Totally fine — you can use any lender you want. Loan milestones will need to be updated manually, and ARIVE automation won&apos;t apply.
          </p>
        </button>
      </div>
    </div>
  );
}

// ─── Screen 10: Notifications ─────────────────────────────────────────────────

function NotificationsScreen({
  data, onToggle, onContinue,
}: {
  data: AgentSetupData;
  onToggle: (key: keyof AgentSetupData) => void;
  onContinue: () => void;
}) {
  return (
    <div className="flex flex-col items-center">
      <Question text="How do you want to stay in the loop?" note="You can change these anytime in Settings" />
      <div className="w-full max-w-sm space-y-2">
        {NOTIF_ITEMS.map(({ key, label, sub }) => {
          const on = data[key] as boolean;
          return (
            <button
              key={key}
              onClick={() => onToggle(key)}
              className={[
                'flex w-full items-center justify-between gap-3 rounded-xl px-4 py-3.5 transition-all border',
                on ? 'bg-brand-navy/5 border-brand-navy/20' : 'bg-gray-50 border-gray-100',
              ].join(' ')}
            >
              <div className="text-left">
                <p className={`text-sm font-semibold ${on ? 'text-brand-navy' : 'text-gray-500'}`}>{label}</p>
                <p className="text-xs text-gray-400 mt-0.5">{sub}</p>
              </div>
              <div className={[
                'relative inline-flex h-6 w-11 flex-shrink-0 items-center rounded-full transition-colors',
                on ? 'bg-brand-navy' : 'bg-gray-200',
              ].join(' ')}>
                <span className={[
                  'inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform',
                  on ? 'translate-x-6' : 'translate-x-1',
                ].join(' ')} />
              </div>
            </button>
          );
        })}
        <ContinueBtn onClick={onContinue} />
      </div>
    </div>
  );
}

// ─── Screen 11: Integrations ──────────────────────────────────────────────────

function IntegrationsScreen({
  data, onToggle, onContinue,
}: {
  data: AgentSetupData;
  onToggle: (key: keyof AgentSetupData) => void;
  onContinue: () => void;
}) {
  return (
    <div className="flex flex-col items-center">
      <Question
        text="What tools are you already using?"
        note="Tell us your stack — we build integrations in order of what agents actually use"
      />
      <div className="w-full max-w-sm">
        <div className="grid grid-cols-2 gap-2.5 mb-2">
          {INTEGRATION_TOOLS.map(({ key, name, logo, desc }) => {
            const selected = data[key] as boolean;
            return (
              <button
                key={key}
                onClick={() => onToggle(key)}
                className={[
                  'flex flex-col items-start rounded-xl p-3.5 text-left transition-all border-2',
                  selected
                    ? 'border-brand-navy bg-brand-navy/5'
                    : 'border-gray-100 bg-white hover:border-gray-200',
                ].join(' ')}
              >
                <div className="flex w-full items-start justify-between mb-2">
                  <span className="text-2xl leading-none">{logo}</span>
                  <div className={[
                    'flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full transition-all',
                    selected ? 'bg-brand-navy text-white' : 'bg-gray-100 text-transparent',
                  ].join(' ')}>
                    <Check size={11} strokeWidth={3} />
                  </div>
                </div>
                <span className={`text-xs font-bold ${selected ? 'text-brand-navy' : 'text-gray-700'}`}>{name}</span>
                <span className="text-[10px] text-gray-400 mt-0.5 leading-snug">{desc}</span>
              </button>
            );
          })}
        </div>
        <p className="mb-4 text-center text-[11px] text-gray-300">
          You can connect any of these from Settings → Integrations later.
        </p>
        <ContinueBtn onClick={onContinue} label="Almost done!" />
        <SkipLink onClick={onContinue} label="None of these — skip" />
      </div>
    </div>
  );
}

// ─── Screen 12: Document Templates ───────────────────────────────────────────

const ONBOARDING_DOC_TYPES: { docType: DocType; desc: string }[] = [
  { docType: 'baa',               desc: 'Required before showing homes to buyers' },
  { docType: 'listing_agreement', desc: 'For your seller clients' },
  { docType: 'purchase_contract', desc: 'Standard purchase agreement template' },
  { docType: 'disclosure',        desc: 'Property disclosure statement' },
];

function DocumentsScreen({ onContinue }: { onContinue: () => void }) {
  const { docs, uploadDoc, removeDoc } = useAgentDocs();
  const [pendingType, setPendingType] = useState<DocType | null>(null);
  const [err, setErr] = useState<string>('');

  async function handleFile(docType: DocType, e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setErr('');
    setPendingType(docType);
    try {
      await uploadDoc(file, docType, DOC_TYPE_LABELS[docType], '');
    } catch (uploadErr) {
      setErr(uploadErr instanceof Error ? uploadErr.message : 'Upload failed. Please try again.');
    } finally {
      setPendingType(null);
    }
  }

  return (
    <div>
      <div className="mb-6 text-center">
        <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-blue-100">
          <FileText size={28} className="text-blue-600" />
        </div>
        <h2 className="text-2xl font-black text-brand-navy">Upload your templates</h2>
        <p className="mt-2 text-sm text-gray-500 leading-relaxed max-w-xs mx-auto">
          Add the documents you use most — they&apos;ll be ready to send to clients at the right stage. You can always update these in Settings.
        </p>
      </div>

      <div className="space-y-2 mb-4">
        {ONBOARDING_DOC_TYPES.map(({ docType, desc }) => {
          const doc = docs.find((d) => d.docType === docType);
          const added = !!doc;
          const isUploading = pendingType === docType;
          return (
            <div key={docType} className={`flex items-center gap-3 rounded-xl border px-4 py-3.5 transition-all ${
              added ? 'border-green-200 bg-green-50' : 'border-gray-200 bg-white'
            }`}>
              <div className={`flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg ${
                added ? 'bg-green-100' : 'bg-gray-100'
              }`}>
                <FileText size={16} className={added ? 'text-green-600' : 'text-gray-400'} />
              </div>
              <div className="flex-1 min-w-0">
                <p className={`text-sm font-semibold ${added ? 'text-green-800' : 'text-brand-navy'}`}>
                  {DOC_TYPE_LABELS[docType]}
                </p>
                <p className="text-xs text-gray-400 truncate">
                  {added ? doc!.fileName : desc}
                </p>
              </div>
              {added ? (
                <button
                  onClick={() => removeDoc(doc!.id)}
                  className="flex-shrink-0 text-gray-300 hover:text-red-400 transition-colors"
                  aria-label={`Remove ${DOC_TYPE_LABELS[docType]}`}
                >
                  <Trash2 size={14} />
                </button>
              ) : (
                <label className={[
                  'flex-shrink-0 flex items-center gap-1.5 rounded-lg border border-brand-navy/20 bg-brand-navy/5 px-3 py-1.5 text-xs font-bold text-brand-navy transition-colors',
                  isUploading ? 'opacity-60 cursor-progress' : 'cursor-pointer hover:bg-brand-navy/10',
                ].join(' ')}>
                  <Upload size={11} />
                  {isUploading ? 'Uploading…' : 'Upload'}
                  <input
                    type="file"
                    accept=".pdf,.doc,.docx"
                    className="hidden"
                    disabled={isUploading}
                    onChange={(e) => handleFile(docType, e)}
                  />
                </label>
              )}
            </div>
          );
        })}
      </div>

      {err && (
        <p className="mb-3 text-xs text-red-500 text-center">{err}</p>
      )}

      <button
        onClick={onContinue}
        className="flex w-full items-center justify-center gap-2 rounded-xl bg-brand-navy py-4 text-base font-bold text-white hover:bg-brand-navy/80 active:scale-[0.98] transition-all"
      >
        {docs.length > 0 ? `Continue with ${docs.length} template${docs.length !== 1 ? 's' : ''}` : 'Continue'} <ArrowRight size={18} />
      </button>
      {docs.length === 0 && (
        <button onClick={onContinue} className="mt-2 w-full text-sm text-gray-400 hover:text-gray-600 py-2 transition-colors">
          Skip for now — add later in Settings
        </button>
      )}
    </div>
  );
}

// ─── Screen 13: Done ──────────────────────────────────────────────────────────

// ─── Screen 13: Commission Defaults ───────────────────────────────────────────

function CommissionInput({
  label, isPct, pct, amount, onToggle, onPctChange, onAmountChange, salePreview,
}: {
  label: string;
  isPct: boolean;
  pct: number;
  amount: number;
  onToggle: () => void;
  onPctChange: (v: number) => void;
  onAmountChange: (v: number) => void;
  salePreview?: number;
}) {
  // Local string buffer for the visible input so typing "2." or clearing the
  // field doesn't snap back to 0 on every keystroke. We commit to the parent
  // numeric state on each valid change.
  const [pctStr, setPctStr] = useState<string>(String(pct ?? ''));
  const [amountStr, setAmountStr] = useState<string>(String(amount ?? ''));

  useEffect(() => {
    setPctStr(String(pct ?? ''));
  }, [pct]);
  useEffect(() => {
    setAmountStr(String(amount ?? ''));
  }, [amount]);

  const dollarEquiv = salePreview && isPct ? Math.round(salePreview * pct / 100) : null;
  const pctEquiv = salePreview && !isPct && salePreview > 0 ? ((amount / salePreview) * 100).toFixed(2) : null;

  return (
    <div className="rounded-xl border border-gray-200 bg-gray-50 p-4 space-y-3">
      <p className="text-sm font-bold text-brand-navy">{label}</p>
      {/* Toggle */}
      <div className="flex rounded-xl overflow-hidden border border-gray-200">
        <button
          onClick={() => !isPct && onToggle()}
          className={`flex-1 py-2 text-xs font-bold transition-colors ${isPct ? 'bg-brand-navy text-white' : 'bg-white text-gray-500 hover:bg-gray-100'}`}
        >
          Percentage %
        </button>
        <button
          onClick={() => isPct && onToggle()}
          className={`flex-1 py-2 text-xs font-bold transition-colors ${!isPct ? 'bg-brand-navy text-white' : 'bg-white text-gray-500 hover:bg-gray-100'}`}
        >
          Fixed Amount $
        </button>
      </div>
      {/* Input */}
      {isPct ? (
        <div className="flex items-center gap-2 rounded-xl border border-brand-navy/20 bg-white px-4 py-3">
          <input
            type="text"
            inputMode="decimal"
            value={pctStr}
            onChange={(e) => {
              const v = e.target.value;
              // Allow empty, digits, and one decimal point.
              if (v === '' || /^\d*\.?\d*$/.test(v)) {
                setPctStr(v);
                const n = parseFloat(v);
                onPctChange(isNaN(n) ? 0 : n);
              }
            }}
            className="flex-1 text-xl font-black text-brand-navy outline-none bg-transparent"
          />
          <span className="text-lg font-bold text-gray-400">%</span>
        </div>
      ) : (
        <div className="flex items-center gap-2 rounded-xl border border-brand-navy/20 bg-white px-4 py-3">
          <span className="text-lg font-bold text-gray-400">$</span>
          <input
            type="text"
            inputMode="numeric"
            value={amountStr}
            onChange={(e) => {
              const v = e.target.value;
              if (v === '' || /^\d+$/.test(v)) {
                setAmountStr(v);
                const n = parseInt(v, 10);
                onAmountChange(isNaN(n) ? 0 : n);
              }
            }}
            className="flex-1 text-xl font-black text-brand-navy outline-none bg-transparent"
          />
        </div>
      )}
      {/* Equivalent */}
      {salePreview && (
        <p className="text-xs text-gray-400 text-center">
          {isPct && dollarEquiv !== null
            ? `≈ $${dollarEquiv.toLocaleString()} on a $${salePreview.toLocaleString()} sale`
            : !isPct && pctEquiv !== null
            ? `≈ ${pctEquiv}% of a $${salePreview.toLocaleString()} sale`
            : null}
        </p>
      )}
    </div>
  );
}

function CommissionScreen({
  data, onChange, onContinue, onSkip,
}: {
  data: AgentSetupData;
  onChange: <K extends keyof AgentSetupData>(key: K, val: AgentSetupData[K]) => void;
  onContinue: () => void;
  onSkip: () => void;
}) {
  return (
    <div>
      <Question
        text="What's your typical commission?"
        note="These pre-fill your net sheets on every deal. You can always adjust per transaction."
      />
      <div className="space-y-4">
        <CommissionInput
          label="Buyer Representation"
          isPct={data.buyerCommissionIsPct}
          pct={data.buyerCommissionPct}
          amount={data.buyerCommissionAmount}
          onToggle={() => onChange('buyerCommissionIsPct', !data.buyerCommissionIsPct)}
          onPctChange={(v) => onChange('buyerCommissionPct', v)}
          onAmountChange={(v) => onChange('buyerCommissionAmount', v)}
          salePreview={350000}
        />
        <CommissionInput
          label="Listing / Seller Representation"
          isPct={data.sellerCommissionIsPct}
          pct={data.sellerCommissionPct}
          amount={data.sellerCommissionAmount}
          onToggle={() => onChange('sellerCommissionIsPct', !data.sellerCommissionIsPct)}
          onPctChange={(v) => onChange('sellerCommissionPct', v)}
          onAmountChange={(v) => onChange('sellerCommissionAmount', v)}
          salePreview={350000}
        />
      </div>
      <ContinueBtn onClick={onContinue} label="Save & Continue" />
      <SkipLink onClick={onSkip} label="Skip — I'll set this in Settings" />
    </div>
  );
}

// ─── Screen 14: Done ──────────────────────────────────────────────────────────

function DoneScreen({ data }: { data: AgentSetupData }) {
  const router = useRouter();
  const { docs } = useAgentDocs();
  const markOnboardingComplete = useAuthStore((s) => s.markOnboardingComplete);
  const docCount = docs.length;
  const isSolo = !data.tcName;

  useEffect(() => {
    const profileUpdate: Record<string, string> = {};
    if (data.name) profileUpdate.name = data.name;
    if (data.phone) profileUpdate.phone = data.phone;
    api.patch('/me/profile', Object.keys(profileUpdate).length > 0 ? profileUpdate : {})
      .then(() => markOnboardingComplete())
      .catch(() => markOnboardingComplete());

    // Keys here mirror what `ProfileSection` in SettingsPage reads, so the
    // onboarding answers are visible the moment the agent lands in Settings.
    const settings = {
      title: data.title,
      phone: data.phone,
      licenseNumber: data.licenseNumber,
      brokerage: data.brokerage,
      brokerageAddress: data.brokerageAddress,
      bio: data.bio,
      photoUrl: data.photoUrl,
      lenderChoice: data.lenderChoice,
      buyerWelcomeMessage: data.buyerMessage,
      sellerWelcomeMessage: data.sellerMessage,
      tc: data.tcName ? { name: data.tcName, email: data.tcEmail, phone: data.tcPhone } : null,
      notifications: {
        deal_stage: data.notifDealStage,
        client_messages: data.notifClientMsg,
        overdue: data.notifOverdue,
        disclosures: data.notifDisclosures,
        fast_pass: data.notifFastPass,
      },
      integrations: {
        docusign: data.toolDocuSign,
        google_cal: data.toolGoogleCal,
        outlook: data.toolOutlook,
        dotloop: data.toolDotloop,
        skyslope: data.toolSkyslope,
        zapier: data.toolZapier,
      },
      buyerCommission: {
        isPct: data.buyerCommissionIsPct,
        pct: data.buyerCommissionIsPct ? data.buyerCommissionPct : null,
        amount: data.buyerCommissionIsPct ? null : data.buyerCommissionAmount,
      },
      sellerCommission: {
        isPct: data.sellerCommissionIsPct,
        pct: data.sellerCommissionIsPct ? data.sellerCommissionPct : null,
        amount: data.sellerCommissionIsPct ? null : data.sellerCommissionAmount,
      },
      setupComplete: true,
    };
    api.put('/me/settings', settings).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const summary = [
    { label: 'Profile',    value: data.title ? `${data.title}${data.brokerage ? ` · ${data.brokerage}` : ''}` : 'Complete', ok: true },
    { label: 'TC',         value: isSolo ? 'Solo mode — TC tasks built into your view' : data.tcName, ok: true },
    { label: 'Lender',     value: data.lenderChoice === 'mountain' ? 'Mountain Mortgage (ARIVE integrated)' : data.lenderChoice === 'other' ? 'Other lender — milestones managed manually' : 'Will configure in Settings', ok: !!data.lenderChoice },
    { label: 'Messages',   value: 'Buyer & seller templates saved', ok: true },
    { label: 'Documents',  value: docCount > 0 ? `${docCount} template${docCount !== 1 ? 's' : ''} uploaded` : 'None yet — add in Settings', ok: docCount > 0 },
    { label: 'Integrations', value: INTEGRATION_TOOLS.filter(t => data[t.key] as boolean).map(t => t.name).join(', ') || 'None selected', ok: true },
  ];

  return (
    <div className="flex flex-col items-center text-center">
      <div className="mb-5 flex h-16 w-16 items-center justify-center rounded-2xl bg-green-100">
        <CheckCircle2 size={36} className="text-green-500" />
      </div>
      <h2 className="text-3xl font-black text-brand-navy">Your office is live.</h2>
      <p className="mt-2 text-sm text-gray-500 max-w-xs">
        Everything is set. Here&apos;s a quick summary of what we configured.
      </p>

      {/* Summary */}
      <div className="mt-6 w-full max-w-sm rounded-2xl bg-gray-50 divide-y divide-gray-100 overflow-hidden text-left">
        {summary.map(({ label, value, ok }) => (
          <div key={label} className="flex items-start gap-3 px-4 py-3">
            <div className={`mt-0.5 flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full ${ok ? 'bg-green-100' : 'bg-gray-200'}`}>
              <Check size={11} strokeWidth={3} className={ok ? 'text-green-600' : 'text-gray-400'} />
            </div>
            <div>
              <p className="text-xs font-bold text-gray-500 uppercase tracking-wide">{label}</p>
              <p className="text-sm text-brand-navy leading-snug mt-0.5">{value}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Actions */}
      <div className="mt-6 w-full max-w-sm space-y-2.5">
        <button
          onClick={() => router.push('/agent')}
          className="flex w-full items-center justify-center gap-2 rounded-xl bg-brand-navy py-4 text-base font-bold text-white hover:bg-brand-navy/80 active:scale-[0.98] transition-all"
        >
          Go to my dashboard <ArrowRight size={18} />
        </button>
        <button
          onClick={() => router.push('/agent/deals')}
          className="flex w-full items-center justify-center gap-2 rounded-xl border border-gray-200 bg-white py-3.5 text-sm font-semibold text-brand-navy hover:bg-gray-50 transition-all"
        >
          Create my first deal →
        </button>
      </div>
    </div>
  );
}

// ─── Main ─────────────────────────────────────────────────────────────────────

export default function AgentOnboarding() {
  const router = useRouter();
  const { dismissBanner } = useAgentSetupStore();
  const markOnboardingComplete = useAuthStore((s) => s.markOnboardingComplete);
  const [screen, setScreen] = useState(0);
  const [data, setData] = useState<AgentSetupData>(EMPTY);

  function set<K extends keyof AgentSetupData>(key: K, val: AgentSetupData[K]) {
    setData((d) => ({ ...d, [key]: val }));
  }

  function toggle(key: keyof AgentSetupData) {
    setData((d) => ({ ...d, [key]: !d[key] }));
  }

  function advance() { setScreen((s) => s + 1); }
  function back()    { setScreen((s) => Math.max(s - 1, 1)); }

  function skipToEnd() {
    dismissBanner();
    api.patch('/me/profile', {}).catch(() => {});
    markOnboardingComplete();
    router.push('/agent');
  }

  const progress =
    screen === 0  ? 3 :
    screen === 14 ? 100 :
    Math.round((screen / (TOTAL_STEPS + 1)) * 100);

  const stepLabel = STEP_LABELS[screen];
  const showBack  = screen >= 1 && screen <= TOTAL_STEPS;

  function renderScreen() {
    switch (screen) {
      case 0: return <WelcomeScreen onStart={advance} onSkip={skipToEnd} />;

      case 1: return (
        <NameScreen value={data.name} onChange={(v) => set('name', v)}
          onContinue={advance} />
      );

      case 2: return (
        <TitleScreen onSelect={(v) => { set('title', v); advance(); }} />
      );

      case 3: return (
        <PhoneLicenseScreen
          phone={data.phone} license={data.licenseNumber}
          onChangePhone={(v) => set('phone', v)}
          onChangeLicense={(v) => set('licenseNumber', v)}
          onContinue={advance}
        />
      );

      case 4: return (
        <PhotoScreen
          selected={data.photoUrl}
          name={data.name}
          onSelect={(v) => set('photoUrl', v)}
          onContinue={advance}
          onSkip={advance}
        />
      );

      case 5: return (
        <BioScreen
          value={data.bio}
          onChange={(v) => set('bio', v)}
          onContinue={advance}
          onSkip={advance}
        />
      );

      case 6: return (
        <BrokerageScreen onSelect={(name, address) => { set('brokerage', name); set('brokerageAddress', address); advance(); }} />
      );

      case 7: return (
        <TCScreen
          tcName={data.tcName} tcEmail={data.tcEmail}
          tcPhone={data.tcPhone} tcLinkedUserId={data.tcLinkedUserId}
          onChange={(field, val) => set(field, val)}
          onContinue={advance}
          onSolo={() => { set('tcName', ''); set('tcEmail', ''); advance(); }}
        />
      );

      case 8: return (
        <WelcomeMessagesScreen
          buyerMsg={data.buyerMessage} sellerMsg={data.sellerMessage}
          onBuyerChange={(v) => set('buyerMessage', v)}
          onSellerChange={(v) => set('sellerMessage', v)}
          onContinue={advance}
        />
      );

      case 9: return (
        <LenderScreen onSelect={(v) => { set('lenderChoice', v); advance(); }} />
      );

      case 10: return (
        <NotificationsScreen data={data} onToggle={toggle} onContinue={advance} />
      );

      case 11: return (
        <IntegrationsScreen data={data} onToggle={toggle} onContinue={advance} />
      );

      case 12: return (
        <DocumentsScreen onContinue={advance} />
      );

      case 13: return (
        <CommissionScreen data={data} onChange={set} onContinue={advance} onSkip={advance} />
      );

      case 14: return <DoneScreen data={data} />;

      default: return null;
    }
  }

  return (
    <OnboardingLayout
      progress={progress}
      onBack={showBack ? back : undefined}
      label="Agent"
      stepLabel={stepLabel}
    >
      {renderScreen()}
    </OnboardingLayout>
  );
}
