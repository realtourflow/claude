import type { Metadata } from "next";
import {
  LayoutDashboard,
  ClipboardCheck,
  Users,
  FileSignature,
  CalendarCheck,
  Building2,
  BadgeDollarSign,
  ArrowRight,
  Sparkles,
  ChevronDown,
} from "lucide-react";
import WaitlistForm from "@/components/landing/WaitlistForm";

export const metadata: Metadata = {
  title: "RealTourFlow — The deal command center for real estate agents",
  description:
    "Track every buyer and seller transaction in one place. Auto-tasks, client portals, document e-sign, and live loan milestones. Join the founding-agent list.",
  alternates: {
    canonical: "https://realtourflow.com/",
  },
};

const FEATURES = [
  {
    icon: LayoutDashboard,
    title: "One pipeline, total clarity.",
    body: "See every active deal and exactly what stage it's in, on one screen.",
  },
  {
    icon: ClipboardCheck,
    title: "The system tells you what's next.",
    body: "Each stage auto-loads its tasks and deadlines. Nothing slips.",
  },
  {
    icon: Users,
    title: "Clients stop texting 'any update?'",
    body: "Buyers and sellers get a portal with progress, next steps, and docs.",
  },
  {
    icon: FileSignature,
    title: "Docs, e-sign, disclosures — handled.",
    body: "Send for signature and bundle disclosure packets without leaving the deal.",
  },
  {
    icon: CalendarCheck,
    title: "Closing dates hit your calendar.",
    body: "Connect Google or Outlook; every key date shows up automatically.",
  },
  {
    icon: Building2,
    title: "Bonus: live loan milestones.",
    body: "Mountain Mortgage buyers sync loan status automatically. Works with any lender.",
  },
];

const FAQ_ITEMS = [
  {
    q: "When does it launch?",
    a: "We're onboarding agents in waves now and opening up more broadly through 2026. Get on the list and we'll bring you in as soon as there's room.",
  },
  {
    q: "What do founding agents get?",
    a: "$3,000–$5,000 in credits on every deal, early-access pricing, and direct input on the roadmap.",
  },
  {
    q: "Who is this for?",
    a: "Residential agents who run buyer and seller deals and are tired of juggling them across spreadsheets, texts, and email.",
  },
  {
    q: "Do I have to use a specific lender?",
    a: "No. RealTourFlow works for every deal, regardless of lender. If your buyer uses Mountain Mortgage, you get an extra perk — automatic loan status updates and special lender credits (up to $1,787) — but it's never required. We built this for agents, for agents to use freely.",
  },
  {
    q: "Is my data safe?",
    a: "Yes. Your deals, documents, and client info are private to you and stored securely.",
  },
];

const S = {
  navy: "#00163b",
  navyLight: "#002855",
  gold: "#d6bf8d",
  bg: "#f8f6f3",
  white: "#ffffff",
  textPrimary: "#111827",
  textSecondary: "#4b5563",
  textMuted: "#9ca3af",
  border: "#e5e7eb",
  borderMed: "#d1d5db",
  infoText: "#1e40af",
  infoBg: "#eff6ff",
  successText: "#065f46",
  successBg: "#ecfdf5",
  successBorder: "#6ee7b7",
  cardBg: "#ffffff",
  cardBorder: "#e5e7eb",
} as const;

export default function LandingPage() {
  return (
    <div style={{ background: S.bg, minHeight: "100vh", color: S.textPrimary, fontFamily: "inherit" }}>
      {/* ── Nav ── */}
      <nav
        style={{
          position: "sticky",
          top: 0,
          zIndex: 10,
          background: S.white,
          borderBottom: `1px solid ${S.border}`,
          padding: "0 24px",
        }}
      >
        <div
          style={{
            maxWidth: 1100,
            margin: "0 auto",
            position: "relative",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            height: 72,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 11 }}>
            <div
              style={{
                width: 38,
                height: 38,
                borderRadius: 9,
                background: S.navy,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                flexShrink: 0,
              }}
            >
              <LayoutDashboard size={22} color={S.gold} />
            </div>
            <span
              style={{
                fontSize: "clamp(22px, 5vw, 28px)",
                fontWeight: 700,
                color: S.navy,
                letterSpacing: "-0.02em",
              }}
            >
              RealTourFlow
            </span>
          </div>
          <a
            href="/agent"
            style={{
              position: "absolute",
              right: 0,
              top: "50%",
              transform: "translateY(-50%)",
              fontSize: 14,
              fontWeight: 500,
              color: S.textSecondary,
              textDecoration: "none",
              display: "flex",
              alignItems: "center",
              gap: 4,
            }}
          >
            Sign in <ArrowRight size={14} />
          </a>
        </div>
      </nav>

      <main>
        {/* ── Hero ── */}
        <section
          style={{
            maxWidth: 1100,
            margin: "0 auto",
            padding: "72px 24px 48px",
            textAlign: "center",
          }}
        >
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              background: S.infoBg,
              color: S.infoText,
              borderRadius: 999,
              padding: "6px 14px",
              fontSize: 13,
              fontWeight: 500,
            }}
          >
            <Sparkles size={13} />
            Coming soon · founding agents wanted
          </span>

          <h1
            style={{
              fontSize: "clamp(28px, 5vw, 44px)",
              fontWeight: 700,
              lineHeight: 1.2,
              letterSpacing: "-0.025em",
              margin: "20px 0 0",
              color: S.navy,
              maxWidth: 680,
              marginLeft: "auto",
              marginRight: "auto",
            }}
          >
            Stop running your deals out of your text messages.
          </h1>

          <p
            style={{
              fontSize: 18,
              lineHeight: 1.7,
              color: S.textSecondary,
              maxWidth: 580,
              margin: "20px auto 0",
            }}
          >
            RealTourFlow is the deal command center for real estate agents. The moment a buyer
            or seller becomes your client, it takes over — every task, deadline, document, and
            client update, managed straight through to closing.
          </p>

          <div style={{ display: "flex", gap: 12, justifyContent: "center", marginTop: 32, flexWrap: "wrap" }}>
            <a
              href="#capture"
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 8,
                background: S.navy,
                color: S.white,
                borderRadius: 9,
                padding: "14px 26px",
                fontSize: 16,
                fontWeight: 600,
                textDecoration: "none",
              }}
            >
              Get early access <ArrowRight size={18} />
            </a>
            <a
              href="#how"
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 8,
                background: "transparent",
                color: S.navy,
                border: `1.5px solid ${S.navyLight}`,
                borderRadius: 9,
                padding: "14px 26px",
                fontSize: 16,
                fontWeight: 600,
                textDecoration: "none",
              }}
            >
              See how it works
            </a>
          </div>

          {/* Credits strip */}
          <div
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 10,
              background: S.successBg,
              border: `1px solid ${S.successBorder}`,
              borderRadius: 10,
              padding: "12px 20px",
              marginTop: 28,
            }}
          >
            <BadgeDollarSign size={20} color={S.successText} />
            <span style={{ fontSize: 15, fontWeight: 600, color: S.successText }}>
              Founding agents get $3,000–$5,000 in credits on every deal.
            </span>
          </div>
        </section>

        {/* ── Pipeline preview SVG ── */}
        <section style={{ maxWidth: 900, margin: "0 auto", padding: "0 24px 56px" }}>
          <div
            style={{
              background: S.white,
              border: `1px solid ${S.border}`,
              borderRadius: 16,
              padding: "20px 20px 14px",
              boxShadow: "0 1px 4px rgba(0,0,0,0.06)",
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                marginBottom: 16,
              }}
            >
              <span
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 7,
                  fontSize: 13,
                  fontWeight: 500,
                  color: S.textSecondary,
                }}
              >
                <LayoutDashboard size={15} color={S.infoText} /> Your pipeline
              </span>
              <span style={{ fontSize: 12, color: S.textMuted }}>Updated just now</span>
            </div>

            <svg
              viewBox="0 0 640 290"
              width="100%"
              role="img"
              xmlns="http://www.w3.org/2000/svg"
              style={{ display: "block" }}
            >
              <title>RealTourFlow deal pipeline</title>
              <desc>
                Seven deal stages — intake through closed — with two sample deal cards and an
                auto-loaded task strip showing what fires when a deal advances.
              </desc>

              {/* Progress rail */}
              <rect x="0" y="18" width="640" height="3" rx="1.5" fill={S.border} />
              <rect x="0" y="18" width="365" height="3" rx="1.5" fill={S.navy} />
              {/* Completed stage dots */}
              {[0, 91, 182, 274, 365].map((x) => (
                <circle key={x} cx={x} cy={19.5} r={5} fill={S.navy} />
              ))}
              {/* Pending stage dots */}
              {[457, 548, 638].map((x) => (
                <circle key={x} cx={x} cy={19.5} r={4.5} fill={S.bg} stroke={S.borderMed} strokeWidth={1} />
              ))}

              {/* Stage labels */}
              {[
                [0, "intake"],
                [91, "active"],
                [182, "under contract"],
                [274, "inspection"],
                [365, "appraisal"],
                [457, "clear to close"],
                [548, "closed"],
              ].map(([x, label]) => (
                <text
                  key={String(x)}
                  x={Number(x)}
                  y="42"
                  fill={Number(x) <= 365 ? S.textSecondary : S.textMuted}
                  fontSize="10.5"
                  fontFamily="inherit"
                >
                  {String(label)}
                </text>
              ))}

              {/* Deal card 1 */}
              <rect x="0" y="58" width="305" height="90" rx="10" fill={S.white} stroke={S.border} strokeWidth="1" />
              <rect x="14" y="74" width="46" height="18" rx="9" fill={S.infoBg} />
              <text x="37" y="87" textAnchor="middle" fill={S.infoText} fontSize="10" fontFamily="inherit">buyer</text>
              <text x="14" y="116" fill={S.textPrimary} fontSize="14" fontWeight="500" fontFamily="inherit">14 Maple Ave</text>
              <text x="14" y="133" fill={S.textMuted} fontSize="11" fontFamily="inherit">under contract · 3 tasks</text>

              {/* Deal card 2 — featured */}
              <rect x="320" y="58" width="305" height="90" rx="10" fill={S.white} stroke={S.navy} strokeWidth="1.5" />
              <rect x="334" y="74" width="46" height="18" rx="9" fill={S.infoBg} />
              <text x="357" y="87" textAnchor="middle" fill={S.infoText} fontSize="10" fontFamily="inherit">seller</text>
              <text x="334" y="116" fill={S.textPrimary} fontSize="14" fontWeight="500" fontFamily="inherit">88 Oak St</text>
              <text x="334" y="133" fill={S.textMuted} fontSize="11" fontFamily="inherit">active listing · 5 tasks</text>
              {/* Gold accent on featured card */}
              <rect x="320" y="58" width="6" height="90" rx="3" fill={S.gold} />

              {/* Auto-task strip */}
              <rect x="0" y="162" width="640" height="38" rx="9" fill={S.infoBg} stroke="#bfdbfe" strokeWidth="1" />
              <circle cx="20" cy="181" r="8" fill={S.white} />
              <text x="20" y="185" textAnchor="middle" fill={S.infoText} fontSize="11" fontFamily="inherit">→</text>
              <text x="36" y="177" fill={S.infoText} fontSize="11.5" fontWeight="500" fontFamily="inherit">Next up — order appraisal</text>
              <text x="36" y="192" fill={S.infoText} fontSize="10.5" fontFamily="inherit">Auto-loaded when the deal hit appraisal stage</text>

              {/* Task checklist */}
              <rect x="0" y="214" width="640" height="70" rx="9" fill="#fafafa" stroke={S.border} strokeWidth="1" />
              <text x="14" y="234" fill={S.textSecondary} fontSize="11.5" fontFamily="inherit">88 Oak St — active tasks</text>
              <text x="540" y="234" fill={S.textMuted} fontSize="10.5" fontFamily="inherit">3 of 5 done</text>

              {[0, 18].map((dy) => (
                <g key={dy}>
                  <rect x="14" y={247 + dy} width="13" height="13" rx="4" fill={S.infoBg} />
                  <path
                    d={`M17 ${253.5 + dy} l2.5 2.5 4.5-5`}
                    fill="none"
                    stroke={S.infoText}
                    strokeWidth="1.6"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                  <rect x="34" y={252 + dy} width={dy === 0 ? 140 : 110} height="5" rx="2.5" fill={S.borderMed} />
                </g>
              ))}
              {/* Pending task */}
              <rect x="330" y="247" width="13" height="13" rx="4" fill={S.white} stroke={S.borderMed} strokeWidth="1" />
              <rect x="350" y="252" width="120" height="5" rx="2.5" fill={S.border} />
            </svg>
          </div>
        </section>

        {/* ── Email capture ── */}
        <section
          id="capture"
          style={{ maxWidth: 640, margin: "0 auto", padding: "0 24px 64px" }}
        >
          <div
            style={{
              background: S.white,
              border: `1px solid ${S.border}`,
              borderRadius: 16,
              padding: "32px",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
              <Sparkles size={18} color={S.infoText} />
              <h2 style={{ fontSize: 20, fontWeight: 600, color: S.navy, margin: 0 }}>
                Be a founding agent.
              </h2>
            </div>
            <p style={{ fontSize: 15, color: S.textSecondary, lineHeight: 1.7, margin: "10px 0 24px" }}>
              We&rsquo;re onboarding agents in waves before launch — and our first founding members
              get{" "}
              <span
                style={{
                  background: S.successBg,
                  color: S.successText,
                  borderRadius: 6,
                  padding: "1px 7px",
                  fontWeight: 600,
                }}
              >
                $3,000–$5,000 in credits
              </span>{" "}
              on every deal, plus a real say in what we build next.
            </p>
            <WaitlistForm />
          </div>
        </section>

        {/* ── Problem ── */}
        <section
          style={{
            background: S.navy,
            padding: "64px 24px",
          }}
        >
          <div style={{ maxWidth: 700, margin: "0 auto" }}>
            <h2
              style={{
                fontSize: "clamp(22px, 4vw, 32px)",
                fontWeight: 700,
                color: S.white,
                lineHeight: 1.3,
                margin: "0 0 20px",
              }}
            >
              Your transactions are held together with sticky notes and prayer.
            </h2>
            <p style={{ fontSize: 17, color: "#94a3b8", lineHeight: 1.8, margin: 0 }}>
              A spreadsheet here. A group text there. Docs buried in your email. One missed task
              and a deal stalls — or dies. You didn&rsquo;t get your license to be a project
              manager. RealTourFlow takes the chaos off your plate.
            </p>
          </div>
        </section>

        {/* ── Value props ── */}
        <section style={{ maxWidth: 1100, margin: "0 auto", padding: "72px 24px" }}>
          <h2
            style={{
              fontSize: "clamp(20px, 3vw, 28px)",
              fontWeight: 700,
              color: S.navy,
              textAlign: "center",
              margin: "0 0 40px",
            }}
          >
            A little relief, baked into every deal.
          </h2>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
              gap: 16,
            }}
          >
            {FEATURES.map(({ icon: Icon, title, body }) => (
              <div
                key={title}
                style={{
                  background: S.white,
                  border: `1px solid ${S.border}`,
                  borderRadius: 14,
                  padding: 24,
                }}
              >
                <div
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    width: 40,
                    height: 40,
                    borderRadius: 10,
                    background: S.infoBg,
                    marginBottom: 14,
                  }}
                >
                  <Icon size={20} color={S.infoText} />
                </div>
                <h3 style={{ fontSize: 16, fontWeight: 600, color: S.navy, margin: "0 0 8px" }}>
                  {title}
                </h3>
                <p style={{ fontSize: 15, color: S.textSecondary, lineHeight: 1.65, margin: 0 }}>
                  {body}
                </p>
              </div>
            ))}
          </div>
        </section>

        {/* ── How it works ── */}
        <section
          id="how"
          style={{ background: S.white, padding: "72px 24px" }}
        >
          <div style={{ maxWidth: 680, margin: "0 auto" }}>
            <h2
              style={{
                fontSize: "clamp(20px, 3vw, 28px)",
                fontWeight: 700,
                color: S.navy,
                textAlign: "center",
                margin: "0 0 40px",
              }}
            >
              How it works
            </h2>
            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              {[
                {
                  n: 1,
                  title: "Add your client.",
                  body: "Buyer or seller — drop them in and RealTourFlow sets the stage.",
                },
                {
                  n: 2,
                  title: "Move it forward.",
                  body: "Advance a stage; tasks, deadlines, and client updates fire automatically.",
                },
                {
                  n: 3,
                  title: "Close clean.",
                  body: "Docs signed, dates tracked, clients informed. Then do it again, faster.",
                },
              ].map(({ n, title, body }) => (
                <div
                  key={n}
                  style={{
                    display: "flex",
                    gap: 16,
                    alignItems: "flex-start",
                    background: S.bg,
                    border: `1px solid ${S.border}`,
                    borderRadius: 12,
                    padding: "20px 22px",
                  }}
                >
                  <div
                    style={{
                      flexShrink: 0,
                      width: 32,
                      height: 32,
                      borderRadius: "50%",
                      background: S.navy,
                      color: S.gold,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontSize: 15,
                      fontWeight: 700,
                    }}
                  >
                    {n}
                  </div>
                  <div>
                    <p style={{ fontWeight: 600, fontSize: 16, color: S.navy, margin: "0 0 4px" }}>
                      {title}
                    </p>
                    <p style={{ fontSize: 15, color: S.textSecondary, margin: 0, lineHeight: 1.65 }}>
                      {body}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ── Credits callout ── */}
        <section style={{ maxWidth: 1100, margin: "0 auto", padding: "64px 24px" }}>
          <div
            style={{
              background: S.successBg,
              border: `1px solid ${S.successBorder}`,
              borderRadius: 16,
              padding: "40px 32px",
              textAlign: "center",
            }}
          >
            <div
              style={{
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                width: 52,
                height: 52,
                borderRadius: "50%",
                background: S.white,
                marginBottom: 16,
              }}
            >
              <BadgeDollarSign size={26} color={S.successText} />
            </div>
            <p
              style={{
                fontSize: "clamp(18px, 2.5vw, 24px)",
                fontWeight: 700,
                color: S.successText,
                margin: "0 0 10px",
              }}
            >
              Founding agents get $3,000–$5,000 in credits on every deal.
            </p>
            <p style={{ fontSize: 15, color: S.successText, margin: 0 }}>
              Limited spots per onboarding wave.
            </p>
          </div>
        </section>

        {/* ── Social proof ── */}
        <section style={{ maxWidth: 1100, margin: "0 auto", padding: "0 24px 64px" }}>
          <div
            style={{
              background: S.white,
              border: `2px solid ${S.navy}`,
              borderRadius: 16,
              padding: "32px",
            }}
          >
            <svg
              width="28"
              height="24"
              viewBox="0 0 28 24"
              fill={S.border}
              style={{ display: "block", marginBottom: 12 }}
            >
              <path d="M0 24V14.4C0 10.4 1.4 6.8 4.2 3.6 7 .4 10.4 0 14.4 0v4.8C12 4.8 10 5.6 8.4 7.2 6.8 8.8 6 10.8 6 13.2h4.8V24H0zm14.4 0V14.4c0-4 1.4-7.6 4.2-10.8C21.4.4 24.8 0 28.8 0v4.8c-2.4 0-4.4.8-6 2.4-1.6 1.6-2.4 3.6-2.4 6H25.2V24H14.4z" />
            </svg>
            <p
              style={{
                fontSize: 20,
                fontStyle: "italic",
                color: S.navy,
                margin: "0 0 16px",
                lineHeight: 1.5,
                fontFamily: "Georgia, 'Times New Roman', serif",
              }}
            >
              &ldquo;I stopped losing track of deadlines the first week.&rdquo;
            </p>
            <p style={{ fontSize: 14, color: S.textMuted, margin: "0 0 20px" }}>
              — [Agent name], [Brokerage], [City]
            </p>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
              {["Built with real agents", "In active beta", "Launching 2026"].map((label) => (
                <span
                  key={label}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 6,
                    background: S.bg,
                    border: `1px solid ${S.border}`,
                    borderRadius: 999,
                    padding: "6px 14px",
                    fontSize: 13,
                    color: S.textSecondary,
                  }}
                >
                  {label}
                </span>
              ))}
            </div>
          </div>
        </section>

        {/* ── Second CTA ── */}
        <section
          style={{
            background: S.navy,
            padding: "72px 24px",
          }}
        >
          <div style={{ maxWidth: 640, margin: "0 auto" }}>
            <h2
              style={{
                fontSize: "clamp(22px, 3.5vw, 30px)",
                fontWeight: 700,
                color: S.white,
                textAlign: "center",
                margin: "0 0 12px",
              }}
            >
              The agents who get in early get the most.
            </h2>
            <p
              style={{
                fontSize: 16,
                color: "#94a3b8",
                textAlign: "center",
                lineHeight: 1.7,
                margin: "0 0 32px",
              }}
            >
              Founding agents lock in credits and help shape the product. Spots in each wave are
              limited.
            </p>
            <div
              style={{
                background: S.white,
                borderRadius: 16,
                padding: "28px",
              }}
            >
              <WaitlistForm buttonLabel="Get early access" idSuffix="-2" />
            </div>
          </div>
        </section>

        {/* ── FAQ ── */}
        <section style={{ maxWidth: 720, margin: "0 auto", padding: "72px 24px" }}>
          <h2
            style={{
              fontSize: "clamp(20px, 3vw, 26px)",
              fontWeight: 700,
              color: S.navy,
              margin: "0 0 8px",
            }}
          >
            Questions, answered.
          </h2>
          <div>
            {FAQ_ITEMS.map(({ q, a }) => (
              <details
                key={q}
                style={{ borderTop: `1px solid ${S.border}`, padding: "0" }}
              >
                <summary
                  style={{
                    listStyle: "none",
                    cursor: "pointer",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: 12,
                    padding: "18px 0",
                    fontSize: 16,
                    fontWeight: 600,
                    color: S.navy,
                  }}
                >
                  {q}
                  <ChevronDown size={18} color={S.textMuted} style={{ flexShrink: 0 }} />
                </summary>
                <p
                  style={{
                    fontSize: 15,
                    color: S.textSecondary,
                    lineHeight: 1.75,
                    padding: "0 0 20px",
                    margin: 0,
                  }}
                >
                  {a}
                </p>
              </details>
            ))}
            <div style={{ borderTop: `1px solid ${S.border}` }} />
          </div>
        </section>
      </main>

      {/* ── Footer ── */}
      <footer
        style={{
          borderTop: `1px solid ${S.border}`,
          background: S.white,
          padding: "32px 24px",
          textAlign: "center",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8, marginBottom: 10 }}>
          <div
            style={{
              width: 24,
              height: 24,
              borderRadius: 6,
              background: S.navy,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <LayoutDashboard size={14} color={S.gold} />
          </div>
          <span style={{ fontSize: 14, fontWeight: 600, color: S.navy }}>RealTourFlow</span>
        </div>
        <p style={{ fontSize: 14, color: S.textMuted, margin: "0 0 4px" }}>
          The deal command center for real estate agents.
        </p>
        <p style={{ fontSize: 13, color: S.textMuted, margin: 0 }}>© 2026 RealTourFlow</p>
      </footer>
    </div>
  );
}
