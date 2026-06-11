/**
 * Resend email wrapper. Mirrors the seam pattern in web/lib/stripe.ts.
 *
 * - sendInviteEmail({...}) → delivers a deal-invite link to the invitee.
 * - sendAgentInviteEmail({...}) → delivers an agent-signup link to a new agent.
 * - sendNotificationEmail({...}) → delivers a generic deal-activity notice
 *   (new message / document shared / task assigned) linking back to the deal.
 *
 * Test seam: setEmailForTesting() injects a stub that bypasses the real Resend
 * client, so tests never hit the network (CI has no RESEND_API_KEY).
 */
import { Resend } from "resend";
import { env } from "./env";

type EmailResult = {
  data: { id: string } | null;
  error: { message: string } | null;
};

/** The minimal Resend surface we depend on. */
type EmailLike = {
  emails: {
    send: (payload: {
      from: string;
      to: string | string[];
      subject: string;
      html: string;
    }) => Promise<EmailResult>;
  };
};

let stub: EmailLike | undefined;
let real: Resend | undefined;

export function setEmailForTesting(impl: EmailLike | undefined): void {
  stub = impl;
}

function client(): EmailLike {
  if (stub) return stub;
  if (!real) {
    const key = env().RESEND_API_KEY;
    if (!key) throw new Error("RESEND_API_KEY not configured");
    real = new Resend(key);
  }
  return real as unknown as EmailLike;
}

export type SendInviteInput = {
  to: string;
  name: string;
  dealTitle: string;
  inviteUrl: string;
};

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export async function sendInviteEmail(input: SendInviteInput): Promise<void> {
  const { to, name, dealTitle, inviteUrl } = input;
  const subject = `You're invited to ${dealTitle} on RealTourFlow`;
  const safeName = escapeHtml(name);
  const safeTitle = escapeHtml(dealTitle);
  const safeUrl = escapeHtml(inviteUrl);
  const html = `
    <div style="font-family: -apple-system, Segoe UI, Roboto, sans-serif; max-width: 480px; margin: 0 auto;">
      <h2>You're invited to ${safeTitle}</h2>
      <p>Hi ${safeName},</p>
      <p>Your agent has invited you to follow this real estate deal on RealTourFlow.
         Click the button below to view your deal, tasks, and messages.</p>
      <p style="margin: 24px 0;">
        <a href="${safeUrl}"
           style="background: #2563eb; color: #fff; padding: 12px 20px; border-radius: 6px; text-decoration: none;">
          View your deal
        </a>
      </p>
      <p style="color: #6b7280; font-size: 13px;">
        If the button doesn't work, paste this link into your browser:<br />
        <a href="${safeUrl}">${safeUrl}</a>
      </p>
    </div>
  `;

  const { error } = await client().emails.send({
    from: env().RESEND_FROM,
    to,
    subject,
    html,
  });
  // Resend reports API-level failures via `error` rather than throwing — turn
  // it into a throw so the caller's best-effort try/catch logs it uniformly.
  if (error) throw new Error(`Resend send failed: ${error.message}`);
}

export type SendAgentInviteInput = {
  to: string;
  name: string;
  inviteUrl: string;
};

/**
 * Delivers an agent-signup invitation. Ports buildAgentInviteEmail from
 * the legacy Go backend. The caller (the admin create
 * route) invokes this best-effort — a send failure must not block the response.
 */
export async function sendAgentInviteEmail(
  input: SendAgentInviteInput
): Promise<void> {
  const { to, name, inviteUrl } = input;
  const subject = "You're invited to join RealTour Flow as an agent";
  const greeting = name ? `Hi ${escapeHtml(name)},` : "Hi there,";
  const safeUrl = escapeHtml(inviteUrl);
  const html = `<!DOCTYPE html>
<html>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#f8f9fa;margin:0;padding:0;">
<table width="100%" bgcolor="#f8f9fa" cellpadding="0" cellspacing="0">
<tr><td align="center" style="padding:40px 16px;">
<table width="560" bgcolor="#ffffff" cellpadding="0" cellspacing="0" style="border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,.08);">
  <tr><td bgcolor="#0f1b35" style="padding:32px 40px;">
    <p style="margin:0;color:#c9a83c;font-size:12px;font-weight:700;letter-spacing:2px;text-transform:uppercase;">RealTour Flow</p>
    <h1 style="margin:8px 0 0;color:#ffffff;font-size:24px;font-weight:900;">You're invited to join as an agent.</h1>
  </td></tr>
  <tr><td style="padding:32px 40px;">
    <p style="margin:0 0 16px;color:#374151;font-size:16px;">${greeting}</p>
    <p style="margin:0 0 16px;color:#374151;font-size:15px;line-height:1.6;">
      You've been invited to set up your agent account on <strong>RealTour Flow</strong> — the deal operating system built for real estate professionals.
    </p>
    <p style="margin:0 0 24px;color:#6b7280;font-size:14px;line-height:1.6;">
      Click the button below to create your account and complete onboarding. The whole setup takes about 5 minutes. This link expires in 7 days.
    </p>
    <a href="${safeUrl}" style="display:inline-block;background:#0f1b35;color:#ffffff;text-decoration:none;font-weight:700;font-size:15px;padding:14px 32px;border-radius:10px;">
      Set Up My Agent Account →
    </a>
    <p style="margin:24px 0 0;color:#9ca3af;font-size:12px;">
      If you weren't expecting this invitation, you can safely ignore this email.
    </p>
  </td></tr>
  <tr><td style="padding:16px 40px;border-top:1px solid #f3f4f6;">
    <p style="margin:0;color:#d1d5db;font-size:11px;">RealTour Flow · Built for real estate agents</p>
  </td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;

  const { error } = await client().emails.send({
    from: env().RESEND_FROM,
    to,
    subject,
    html,
  });
  if (error) throw new Error(`Resend send failed: ${error.message}`);
}

export type SendNotificationInput = {
  to: string;
  subject: string;
  heading: string;
  body: string;
  dealUrl: string;
};

/**
 * Delivers a generic deal-activity notification — a new message, a shared
 * document, or a task assignment. Shares the email client + HTML template style
 * of sendInviteEmail (heading, body paragraph, a button linking to the deal).
 *
 * Callers invoke this best-effort: a delivery failure must never block the
 * underlying mutation. Like the invite helpers, an API-level `error` is turned
 * into a throw so the caller's try/catch logs it uniformly.
 */
export async function sendNotificationEmail(
  input: SendNotificationInput
): Promise<void> {
  const { to, subject, heading, body, dealUrl } = input;
  const safeHeading = escapeHtml(heading);
  const safeBody = escapeHtml(body);
  const safeUrl = escapeHtml(dealUrl);
  const html = `
    <div style="font-family: -apple-system, Segoe UI, Roboto, sans-serif; max-width: 480px; margin: 0 auto;">
      <h2>${safeHeading}</h2>
      <p>${safeBody}</p>
      <p style="margin: 24px 0;">
        <a href="${safeUrl}"
           style="background: #2563eb; color: #fff; padding: 12px 20px; border-radius: 6px; text-decoration: none;">
          View on RealTourFlow
        </a>
      </p>
      <p style="color: #6b7280; font-size: 13px;">
        If the button doesn't work, paste this link into your browser:<br />
        <a href="${safeUrl}">${safeUrl}</a>
      </p>
    </div>
  `;

  const { error } = await client().emails.send({
    from: env().RESEND_FROM,
    to,
    subject,
    html,
  });
  if (error) throw new Error(`Resend send failed: ${error.message}`);
}
