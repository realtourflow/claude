/**
 * Gate tests for the E2E test-auth seam (T14, #82).
 *
 * POST /api/test-auth mints a signed session for ANY role (including admin)
 * with no credentials — it exists solely for Playwright. The gate must be
 * fail-closed: enabled only when E2E_AUTH === "1" AND we are not running in
 * Vercel production (VERCEL_ENV !== "production"). One mistakenly-set env var
 * in the Vercel prod project must never open an unauthenticated admin mint.
 *
 * Playwright's webServer runs `next dev` with E2E_AUTH=1 and no VERCEL_ENV —
 * that path (case 3 below) must keep working.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { POST } from "@/app/api/test-auth/route";
import { e2eAuthEnabled } from "@/lib/test-auth";
import { prisma } from "@/lib/db";
import { truncateAll } from "../helpers/db";

const ENV_KEYS = ["E2E_AUTH", "VERCEL_ENV"] as const;

let saved: Record<string, string | undefined>;

beforeEach(async () => {
  saved = {};
  for (const k of ENV_KEYS) {
    saved[k] = process.env[k];
    delete process.env[k];
  }
  await truncateAll();
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

function mintRequest(role = "agent"): Request {
  return new Request("http://localhost/api/test-auth", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ role }),
  });
}

describe("e2eAuthEnabled()", () => {
  it("is false when E2E_AUTH is unset", () => {
    expect(e2eAuthEnabled()).toBe(false);
  });

  it('is false for values other than "1"', () => {
    process.env.E2E_AUTH = "true";
    expect(e2eAuthEnabled()).toBe(false);
  });

  it("is true when E2E_AUTH=1 outside Vercel production (next dev / CI)", () => {
    process.env.E2E_AUTH = "1";
    expect(e2eAuthEnabled()).toBe(true);
  });

  it("is false when E2E_AUTH=1 but VERCEL_ENV=production — prod backstop", () => {
    process.env.E2E_AUTH = "1";
    process.env.VERCEL_ENV = "production";
    expect(e2eAuthEnabled()).toBe(false);
  });

  it("is false when E2E_AUTH=1 on a Vercel preview — preview URLs are public and dashboard env vars default to all environments", () => {
    process.env.E2E_AUTH = "1";
    process.env.VERCEL_ENV = "preview";
    expect(e2eAuthEnabled()).toBe(false);
  });
});

describe("POST /api/test-auth gate", () => {
  it("404s when E2E_AUTH is unset", async () => {
    const res = await POST(mintRequest("admin"));
    expect(res.status).toBe(404);
    // And the mint side effect must not have happened.
    expect(await prisma.users.count()).toBe(0);
  });

  it("404s when E2E_AUTH=1 but VERCEL_ENV=production — prod backstop", async () => {
    process.env.E2E_AUTH = "1";
    process.env.VERCEL_ENV = "production";
    const res = await POST(mintRequest("admin"));
    expect(res.status).toBe(404);
    expect(await prisma.users.count()).toBe(0);
  });

  it("mints a session when E2E_AUTH=1 and VERCEL_ENV is unset (Playwright path)", async () => {
    process.env.E2E_AUTH = "1";
    const res = await POST(mintRequest("agent"));
    expect(res.status).toBe(200);

    const body = (await res.json()) as {
      token: string;
      id: string;
      role: string;
      email: string;
    };
    expect(body.token).toBeTruthy();
    expect(body.role).toBe("agent");

    const setCookie = res.headers.get("set-cookie") ?? "";
    expect(setCookie).toContain("rtf_e2e_session=");

    // The seeded user actually landed in the DB.
    expect(await prisma.users.count()).toBe(1);
  });
});
