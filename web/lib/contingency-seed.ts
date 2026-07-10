import { prisma } from "./db";

/**
 * Seed the standard contingencies when a deal goes under contract (#186).
 *
 * Deadlines are relative to the day the deal enters under_contract, using
 * common default periods: 10-day inspection, 21-day financing, 21-day
 * appraisal. Agents/TCs can waive or remove any of them and add corrected
 * ones (with the contract's real dates) from the DealDetail overview or the
 * TC dashboard's Contingencies view.
 *
 * Idempotent: a single INSERT ... WHERE NOT EXISTS that only fires when the
 * deal has NO contingencies at all — so re-entering under_contract, a retry,
 * or an agent's pre-existing manual list never gets duplicated or stomped.
 */
export async function seedStandardContingencies(dealId: string): Promise<void> {
  await prisma.$executeRaw`
    INSERT INTO deal_contingencies (deal_id, label, contingency_type, deadline, sort_order)
    SELECT ${dealId}::uuid, v.label, v.contingency_type, CURRENT_DATE + v.days, v.sort_order
    FROM (VALUES
      ('Inspection contingency', 'inspection', 10, 0),
      ('Financing contingency',  'financing',  21, 1),
      ('Appraisal contingency',  'appraisal',  21, 2)
    ) AS v(label, contingency_type, days, sort_order)
    WHERE NOT EXISTS (
      SELECT 1 FROM deal_contingencies WHERE deal_id = ${dealId}::uuid
    )
  `;
}
