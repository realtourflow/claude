/**
 * Shared page chrome for the marketing blog — the same centered RealTourFlow
 * header and footer as the landing page, wrapped around blog content.
 */
import Link from "next/link";
import { LayoutDashboard, ArrowRight } from "lucide-react";

const S = {
  navy: "#00163b",
  gold: "#d6bf8d",
  bg: "#f8f6f3",
  white: "#ffffff",
  border: "#e5e7eb",
  textSecondary: "#4b5563",
  textMuted: "#9ca3af",
};

export default function BlogShell({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ background: S.bg, minHeight: "100vh", color: "#111827" }}>
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
          <Link href="/" style={{ display: "flex", alignItems: "center", gap: 11, textDecoration: "none" }}>
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
            <span style={{ fontSize: "clamp(22px, 5vw, 28px)", fontWeight: 700, color: S.navy, letterSpacing: "-0.02em" }}>
              RealTourFlow
            </span>
          </Link>
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

      <main>{children}</main>

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
