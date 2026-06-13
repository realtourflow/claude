/**
 * Environment-aware DocuSign template configuration.
 *
 * Agents send standard forms (BAA, listing agreement, disclosures…) as DocuSign
 * TEMPLATES: fields are tagged once on the template in the DocuSign account, so
 * placement is always correct — no coordinate tabs at send time. Template IDs
 * differ between the demo and production accounts, so the mapping lives in the
 * DOCUSIGN_TEMPLATES env var (JSON) and Go-Live is an ID swap, not a code change.
 *
 * Shape:
 *   { "<formKey>": { "templateId": "...", "label": "Buyer Agency Agreement",
 *                    "roleMapping": { "buyer": "Buyer", "agent": "Agent" },
 *                    "purpose": "baa" } }
 *
 * roleMapping maps deal participant roles (buyer/seller/agent) to the template's
 * role names. purpose ('' | 'baa') marks special documents — the BAA form sets
 * it so envelope completion can flip deals.baa_signed in a later phase.
 *
 * Parsing is lazy and validated here (not in env.ts's zod schema) so a malformed
 * value fails template routes with a clear TemplateConfigError instead of
 * breaking every env() consumer app-wide.
 */
import { z } from "zod";
import { env } from "./env";

export class TemplateConfigError extends Error {}

// Unknown form key — a caller mistake (400), unlike a malformed
// DOCUSIGN_TEMPLATES value, which is a server misconfiguration (500).
export class UnknownFormError extends TemplateConfigError {}

// One field on a contract form: a deal-fact or term key mapped to the
// template's tab LABEL. `role` targets the template role whose tabs carry the
// prefill (defaults to the form's first role at send time).
const fieldMapEntrySchema = z.object({
  label: z.string().min(1),
  type: z.enum(["text", "checkbox"]),
  role: z.string().optional(),
});

const entrySchema = z.object({
  templateId: z.string().min(1),
  label: z.string().min(1),
  roleMapping: z.record(z.string(), z.string().min(1)),
  // Allowlist: '' (plain document) or 'baa' (buyer agency agreement).
  purpose: z.enum(["", "baa"]).default(""),
  // Board/association that owns the form (e.g. BIRMINGHAM_AAR). Empty =
  // universal — visible to every market (the BAA).
  board: z.string().default(""),
  // factOrTermKey -> tab mapping driving contract prefill.
  fieldMap: z.record(z.string(), fieldMapEntrySchema).default({}),
});

export type FieldMapEntry = z.infer<typeof fieldMapEntrySchema>;

const configSchema = z.record(z.string(), entrySchema);

export type TemplateConfig = z.infer<typeof entrySchema>;

function parseConfig(): Record<string, TemplateConfig> {
  const raw = env().DOCUSIGN_TEMPLATES;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new TemplateConfigError(
      "DOCUSIGN_TEMPLATES is not valid JSON — fix the env var value"
    );
  }
  const result = configSchema.safeParse(parsed);
  if (!result.success) {
    const issue = result.error.issues[0];
    throw new TemplateConfigError(
      `DOCUSIGN_TEMPLATES is misconfigured at "${issue.path.join(".")}": ${issue.message}`
    );
  }
  return result.data;
}

export function getTemplateConfig(formKey: string): TemplateConfig {
  const config = parseConfig();
  const entry = config[formKey];
  if (!entry) {
    throw new UnknownFormError(
      `no DocuSign template configured for form "${formKey}" — add it to DOCUSIGN_TEMPLATES`
    );
  }
  return entry;
}

export type TemplateListing = {
  key: string;
  label: string;
  roles: string[];
  roleMapping: Record<string, string>;
  purpose: string;
  board: string;
  fieldMap: Record<string, FieldMapEntry>;
};

export function listTemplates(): TemplateListing[] {
  const config = parseConfig();
  return Object.entries(config).map(([key, entry]) => ({
    key,
    label: entry.label,
    roles: Object.keys(entry.roleMapping),
    // Participant role -> template roleName. The send route's per-role
    // overrides are keyed by template roleName, so the picker needs the map.
    roleMapping: entry.roleMapping,
    purpose: entry.purpose,
    board: entry.board,
    fieldMap: entry.fieldMap,
  }));
}

// Forms an agent in the given market can use: their board's forms plus
// universal (board-less) ones. No market -> universal only.
export function listTemplatesForMarket(market: string): TemplateListing[] {
  return listTemplates().filter((t) => t.board === "" || t.board === market);
}
