"use client";

import { useState } from "react";
import { ArrowRight, ShieldCheck } from "lucide-react";

const INPUT: React.CSSProperties = {
  width: "100%",
  boxSizing: "border-box",
  background: "#ffffff",
  border: "1px solid #d1d5db",
  borderRadius: 8,
  color: "#111827",
  fontFamily: "inherit",
  fontSize: 16,
  padding: "11px 13px",
  outline: "none",
};

const LABEL: React.CSSProperties = {
  display: "block",
  fontSize: 13,
  fontWeight: 500,
  color: "#6b7280",
  marginBottom: 6,
};

type State = "idle" | "loading" | "success" | "error";

export default function WaitlistForm({
  buttonLabel = "Save my spot",
  idSuffix = "",
}: {
  buttonLabel?: string;
  idSuffix?: string;
}) {
  const [fields, setFields] = useState({ firstName: "", lastName: "", email: "", brokerage: "" });
  const [state, setState] = useState<State>("idle");
  const [errorMsg, setErrorMsg] = useState("");

  const fid = (name: string) => `rtf-${name}${idSuffix}`;
  const set = (k: keyof typeof fields) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setFields((f) => ({ ...f, [k]: e.target.value }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setState("loading");
    setErrorMsg("");
    try {
      const res = await fetch("/api/waitlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          firstName: fields.firstName,
          lastName: fields.lastName,
          email: fields.email,
          brokerage: fields.brokerage || undefined,
        }),
      });
      if (!res.ok) {
        setErrorMsg((await res.text()).trim() || "Something went wrong. Please try again.");
        setState("error");
        return;
      }
      setState("success");
    } catch {
      setErrorMsg("Network error. Please try again.");
      setState("error");
    }
  }

  if (state === "success") {
    return (
      <div style={{ textAlign: "center", padding: "24px 0" }}>
        <div
          style={{
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            width: 52,
            height: 52,
            borderRadius: "50%",
            background: "#ecfdf5",
            marginBottom: 14,
          }}
        >
          <svg
            width="26"
            height="26"
            viewBox="0 0 24 24"
            fill="none"
            stroke="#059669"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <polyline points="20 6 9 17 4 12" />
          </svg>
        </div>
        <p style={{ fontWeight: 500, fontSize: 18, color: "#111827", margin: "0 0 8px" }}>
          You&rsquo;re on the list.
        </p>
        <p style={{ fontSize: 15, color: "#6b7280", margin: 0 }}>
          We&rsquo;ll reach out when your wave is ready. Watch your inbox.
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={submit}>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))",
          gap: 14,
        }}
      >
        <div>
          <label style={LABEL} htmlFor={fid("first")}>
            First name
          </label>
          <input
            style={INPUT}
            id={fid("first")}
            type="text"
            placeholder="Jordan"
            required
            value={fields.firstName}
            onChange={set("firstName")}
          />
        </div>
        <div>
          <label style={LABEL} htmlFor={fid("last")}>
            Last name
          </label>
          <input
            style={INPUT}
            id={fid("last")}
            type="text"
            placeholder="Rivera"
            required
            value={fields.lastName}
            onChange={set("lastName")}
          />
        </div>
        <div style={{ gridColumn: "1 / -1" }}>
          <label style={LABEL} htmlFor={fid("email")}>
            Email
          </label>
          <input
            style={INPUT}
            id={fid("email")}
            type="email"
            placeholder="jordan@brokerage.com"
            required
            value={fields.email}
            onChange={set("email")}
          />
        </div>
        <div style={{ gridColumn: "1 / -1" }}>
          <label style={LABEL} htmlFor={fid("brokerage")}>
            Office / brokerage
          </label>
          <input
            style={INPUT}
            id={fid("brokerage")}
            type="text"
            placeholder="Keller Williams · Austin"
            value={fields.brokerage}
            onChange={set("brokerage")}
          />
        </div>
      </div>

      {state === "error" && errorMsg && (
        <p style={{ color: "#dc2626", fontSize: 14, margin: "12px 0 0" }}>{errorMsg}</p>
      )}

      <button
        type="submit"
        disabled={state === "loading"}
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: 8,
          width: "100%",
          marginTop: 18,
          background: "#00163b",
          color: "#ffffff",
          border: "none",
          borderRadius: 8,
          padding: "14px 22px",
          fontFamily: "inherit",
          fontSize: 16,
          fontWeight: 500,
          cursor: state === "loading" ? "not-allowed" : "pointer",
          opacity: state === "loading" ? 0.7 : 1,
        }}
      >
        {state === "loading" ? "Saving…" : buttonLabel}
        {state !== "loading" && <ArrowRight size={18} />}
      </button>

      <p
        style={{
          fontSize: 13,
          color: "#9ca3af",
          margin: "12px 0 0",
          textAlign: "center",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: 6,
        }}
      >
        <ShieldCheck size={14} />
        No spam. Just launch updates and your invite when it&rsquo;s your turn.
      </p>
    </form>
  );
}
