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

const entrySchema = z.object({
  templateId: z.string().min(1),
  label: z.string().min(1),
  roleMapping: z.record(z.string(), z.string().min(1)),
  // Allowlist: '' (plain document) or 'baa' (buyer agency agreement).
  purpose: z.enum(["", "baa"]).default(""),
});

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
    throw new TemplateConfigError(
      `no DocuSign template configured for form "${formKey}" — add it to DOCUSIGN_TEMPLATES`
    );
  }
  return entry;
}

export function listTemplates(): Array<{
  key: string;
  label: string;
  roles: string[];
  purpose: string;
}> {
  const config = parseConfig();
  return Object.entries(config).map(([key, entry]) => ({
    key,
    label: entry.label,
    roles: Object.keys(entry.roleMapping),
    purpose: entry.purpose,
  }));
}
