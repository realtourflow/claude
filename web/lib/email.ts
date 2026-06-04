/**
 * Resend email wrapper. Mirrors the seam pattern in web/lib/stripe.ts.
 *
 * - sendInviteEmail({...}) → delivers a deal-invite link to the invitee.
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
