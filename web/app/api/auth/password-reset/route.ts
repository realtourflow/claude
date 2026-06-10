import { error, json } from "@/lib/http";
import { getAuth0Client } from "@/lib/auth0";

// Anti-enumeration: the ONLY success body this route returns. Same answer
// whether the email exists, doesn't exist, or Auth0 errored — an attacker
// learns nothing about which addresses have accounts.
const GENERIC_BODY = {
  ok: true,
  message: "If an account exists, a reset email has been sent.",
} as const;

// Deliberately loose — just enough shape-checking to reject garbage before we
// call Auth0. Real validation happens on Auth0's side.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type PasswordResetBody = {
  email?: unknown;
};

// POST /api/auth/password-reset — PUBLIC (pre-login, no withAuth on purpose).
// Triggers Auth0's hosted change-password email via the public
// dbconnections/change_password endpoint (SPA client id, no secrets).
export async function POST(req: Request): Promise<Response> {
  let body: PasswordResetBody;
  try {
    body = (await req.json()) as PasswordResetBody;
  } catch {
    return error("invalid request body", 400);
  }

  const email = typeof body.email === "string" ? body.email.trim() : "";
  if (!email || !EMAIL_RE.test(email)) {
    return error("a valid email is required", 400);
  }

  try {
    await getAuth0Client().sendPasswordResetEmail(email);
  } catch (err) {
    // Log server-side only — the response must not reveal whether the email
    // exists or that anything went wrong.
    console.error("password reset email failed", err);
  }

  return json(GENERIC_BODY);
}
