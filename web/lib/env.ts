import { z } from "zod";

// Dev fallback for the OAuth CSRF state-cookie HMAC key. Used when the env var
// is unset OR explicitly empty (e.g. copied from .env.example) — but NEVER in
// Vercel production: this string is committed, so falling back there would let
// anyone forge the OAuth state cookie. See the superRefine below.
const DEV_OAUTH_STATE_SECRET = "rtf-dev-oauth-state-secret-change-in-prod";

const MIN_OAUTH_STATE_SECRET_LENGTH = 32;

const shape = z.object({
  // Vercel deployment environment: "production" | "preview" | "development",
  // unset outside Vercel (local dev, vitest, CI, Playwright's `next dev`).
  // This is the signal for "are we in real production" — fail-closed checks
  // key off it.
  VERCEL_ENV: z.string().default(""),

  DATABASE_URL: z.string().url(),

  AUTH0_DOMAIN: z.string().min(1),
  AUTH0_AUDIENCE: z.string().min(1),

  // Public (SPA) client id — same value the browser uses in Providers.tsx.
  // Server-side it feeds Auth0's public dbconnections/change_password call and
  // the client_id on verification-email jobs (so links use this app's settings).
  NEXT_PUBLIC_AUTH0_CLIENT_ID: z.string().default(""),
  // Auth0 database connection that password resets go against.
  AUTH0_DB_CONNECTION: z.string().default("Username-Password-Authentication"),
  // Auth0 Management API M2M credentials (scopes: read:users, update:users).
  // Used for email-verification state + resend; empty = feature disabled.
  AUTH0_MGMT_CLIENT_ID: z.string().default(""),
  AUTH0_MGMT_CLIENT_SECRET: z.string().default(""),

  AWS_REGION: z.string().default(""),
  S3_BUCKET: z.string().default(""),

  STRIPE_SECRET_KEY: z.string().default(""),
  STRIPE_WEBHOOK_SECRET: z.string().default(""),

  DOCUSIGN_INTEGRATION_KEY: z.string().default(""),
  DOCUSIGN_USER_ID: z.string().default(""),
  DOCUSIGN_ACCOUNT_ID: z.string().default(""),
  DOCUSIGN_PRIVATE_KEY: z.string().default(""),
  DOCUSIGN_BASE_URL: z.string().default(""),
  // HMAC key configured in DocuSign Admin → Connect. When set, the public
  // /api/docusign/webhook handler requires a valid X-DocuSign-Signature-* header
  // (HMAC-SHA256 over the raw body) and rejects anything else with 401. Empty =
  // signature verification disabled (legacy/demo — the handler trusts the POST).
  DOCUSIGN_CONNECT_HMAC_KEY: z.string().default(""),
  // JSON map of formKey → {templateId, label, roleMapping, purpose?} for
  // template-based sending (lib/docusign-templates.ts). Template IDs differ
  // between the demo and production DocuSign accounts, so they live in env —
  // Go-Live is an ID swap, never a code change. Kept as a raw string here and
  // parsed lazily so a malformed value breaks template routes with a clear
  // error instead of every env() call app-wide.
  DOCUSIGN_TEMPLATES: z.string().default("{}"),
  // Public webhook URL DocuSign POSTs envelope/recipient events to (e.g.
  // https://app.realtourflow.com/api/docusign/webhook). When set, every
  // envelope is created with a code-controlled eventNotification — survives
  // Go-Live with no admin-UI Connect setup. Empty = no eventNotification.
  DOCUSIGN_WEBHOOK_URL: z.string().default(""),

  ARIVE_API_URL: z.string().default(""),
  ARIVE_API_KEY: z.string().default(""),
  ARIVE_CLIENT_ID: z.string().default(""),
  ARIVE_CLIENT_SECRET: z.string().default(""),
  ARIVE_WEBHOOK_URL: z.string().default(""),

  GOOGLE_OAUTH_CLIENT_ID: z.string().default(""),
  GOOGLE_OAUTH_CLIENT_SECRET: z.string().default(""),
  GOOGLE_OAUTH_REDIRECT_URL: z.string().default(""),

  // HMAC key for the short-lived, signed CSRF state cookie used by the calendar
  // OAuth connect flows (lib/oauth-state.ts). Outside Vercel production it
  // falls back to a dev value when unset or empty so local dev / CI / previews
  // work without config. In production (VERCEL_ENV=production) it is REQUIRED
  // with at least 32 chars — enforced by the superRefine below, which makes
  // env() throw instead of silently using the committed fallback.
  OAUTH_STATE_SECRET: z.string().default(""),

  MICROSOFT_OAUTH_CLIENT_ID: z.string().default(""),
  MICROSOFT_OAUTH_CLIENT_SECRET: z.string().default(""),
  MICROSOFT_OAUTH_REDIRECT_URL: z.string().default(""),
  MICROSOFT_OAUTH_TENANT: z.string().default("common"),

  // Shared secret for the cron-invoked job sweep (/api/jobs/process). When the
  // env var exists, Vercel automatically sends `Authorization: Bearer <value>`
  // on cron invocations. Empty = the sweep endpoint is disabled (503).
  CRON_SECRET: z.string().default(""),

  RESEND_API_KEY: z.string().default(""),
  // From-address for transactional email. Defaults to Resend's shared sandbox
  // sender; set to a verified-domain address (e.g. "RealTourFlow
  // <invites@realtourflow.com>") in production.
  RESEND_FROM: z.string().default("RealTourFlow <onboarding@resend.dev>"),
});

const schema = shape
  // Fail closed in production: the committed dev fallback must never sign
  // real OAuth state cookies. env() is lazy (called at request time, not
  // import time), so a missing secret surfaces as a thrown ZodError on the
  // first request that touches env() — the message below lands in the
  // function logs and names the variable.
  .superRefine((vals, ctx) => {
    if (
      vals.VERCEL_ENV === "production" &&
      vals.OAUTH_STATE_SECRET.length < MIN_OAUTH_STATE_SECRET_LENGTH
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["OAUTH_STATE_SECRET"],
        message:
          `OAUTH_STATE_SECRET must be set to a random value of at least ` +
          `${MIN_OAUTH_STATE_SECRET_LENGTH} characters when ` +
          `VERCEL_ENV=production — refusing to fall back to the committed ` +
          `dev secret. Set OAUTH_STATE_SECRET in the Vercel project ` +
          `environment variables.`,
      });
    }
  })
  // Dev/test/preview convenience: unset or empty resolves to the dev value.
  // Unreachable in production — the refine above already rejected anything
  // shorter than 32 chars there.
  .transform((vals) => ({
    ...vals,
    OAUTH_STATE_SECRET: vals.OAUTH_STATE_SECRET || DEV_OAUTH_STATE_SECRET,
  }));

export type Env = z.infer<typeof schema>;

let cached: Env | undefined;

export function env(): Env {
  if (!cached) {
    cached = schema.parse(process.env);
  }
  return cached;
}

/**
 * Test seam — drops the cached parse so the next `env()` re-reads `process.env`.
 * Call after mutating `process.env` in a test so the change is observed; the
 * cache is a per-process snapshot otherwise.
 */
export function resetEnvForTesting(): void {
  cached = undefined;
}
