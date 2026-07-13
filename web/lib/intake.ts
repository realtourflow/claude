/**
 * #175 — persisted onboarding intake.
 *
 * The buyer/seller onboarding questionnaire is stored as JSON on the deal
 * itself (`deals.intake` JSONB — migration 000050):
 *
 *   { role: "buyer" | "seller", submitted_at: ISO string, answers: {...} }
 *
 * Two write paths share these helpers:
 *   - POST /api/invites/[token]/claim — the intake rides along with the claim
 *     so the invite's deal gets it atomically.
 *   - POST /api/me/intake — authenticated clients (account-first flow, or a
 *     claim that already happened during AuthSetup) write to their own
 *     participant deal.
 *
 * Read path: GET /api/deals/[id]/intake (agent- or participant-scoped).
 */
import { prisma } from "./db";

export type IntakeRole = "buyer" | "seller";

export type DealIntake = {
  role: IntakeRole;
  submitted_at: string;
  answers: Record<string, unknown>;
};

/** Upper bound on the serialized answers payload — the real questionnaires are
 * ~1–2 KB; anything bigger is abuse or a client bug. */
const MAX_ANSWERS_JSON_CHARS = 20_000;

export function isIntakeRole(v: unknown): v is IntakeRole {
  return v === "buyer" || v === "seller";
}

/**
 * Validates a client-supplied answers payload. Returns the object when it is
 * a plain JSON object under the size cap, otherwise null.
 */
export function parseIntakeAnswers(input: unknown): Record<string, unknown> | null {
  if (typeof input !== "object" || input === null || Array.isArray(input)) return null;
  try {
    if (JSON.stringify(input).length > MAX_ANSWERS_JSON_CHARS) return null;
  } catch {
    return null; // circular / non-serializable
  }
  return input as Record<string, unknown>;
}

/** The seller's property address from the answers, when present. */
export function sellerAddressFromAnswers(
  role: IntakeRole,
  answers: Record<string, unknown>
): string | null {
  if (role !== "seller") return null;
  const v = answers.address;
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

/**
 * Writes the intake JSON onto the deal. For seller intakes, also fills the
 * deal's address when the agent hasn't set one yet — never clobbers an
 * existing address (the seller's version stays visible inside the intake).
 */
export async function applyIntakeToDeal(opts: {
  dealId: string;
  role: IntakeRole;
  answers: Record<string, unknown>;
}): Promise<void> {
  const intake: DealIntake = {
    role: opts.role,
    submitted_at: new Date().toISOString(),
    answers: opts.answers,
  };
  const address = sellerAddressFromAnswers(opts.role, opts.answers);
  const deal = await prisma.deals.findUnique({
    where: { id: opts.dealId },
    select: { address: true },
  });
  await prisma.deals.update({
    where: { id: opts.dealId },
    data: {
      // Cast for Prisma's InputJsonValue: `Record<string, unknown>` answers
      // are guaranteed JSON-serializable by parseIntakeAnswers.
      intake: intake as object,
      ...(address && !deal?.address?.trim() ? { address } : {}),
      updated_at: new Date(),
    },
  });
}
