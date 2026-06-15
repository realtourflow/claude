/**
 * DocuSign template configuration — resolves a form key to its template id,
 * label, role mapping, and fieldMap.
 *
 * Two sources, merged:
 *   1. The committed registry (lib/contract-forms.ts) — each form's structure
 *      lives in code; its template id comes from the DOCUSIGN_TEMPLATE_IDS env
 *      map (demo vs prod differ). A committed form with no id set is not live.
 *   2. DOCUSIGN_TEMPLATES env — full ad-hoc / override entries; wins on key
 *      conflict.
 *
 * Fields are tagged once on the DocuSign template, so placement is always
 * correct — no coordinate tabs at send time. Go-Live = swapping template ids in
 * env, not a code change.
 *
 * Env parsing is lazy and validated here (not in env.ts's zod schema) so a
 * malformed value fails template routes with a clear TemplateConfigError
 * instead of breaking every env() consumer app-wide.
 */
import { z } from "zod";
import { env } from "./env";
import { CONTRACT_FORMS } from "./contract-forms";

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

// Template ids for committed forms: { formKey: templateId }.
function parseTemplateIds(): Record<string, string> {
  const raw = env().DOCUSIGN_TEMPLATE_IDS;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new TemplateConfigError(
      "DOCUSIGN_TEMPLATE_IDS is not valid JSON — fix the env var value"
    );
  }
  const result = z.record(z.string(), z.string()).safeParse(parsed);
  if (!result.success) {
    throw new TemplateConfigError(
      "DOCUSIGN_TEMPLATE_IDS must be a JSON object of formKey → templateId"
    );
  }
  return result.data;
}

// All resolvable forms keyed by form key: committed forms whose template id is
// set in env, overlaid by full DOCUSIGN_TEMPLATES env entries (env wins).
// Committed forms with no template id are omitted — not live yet.
function allForms(): Record<string, TemplateConfig> {
  const ids = parseTemplateIds();
  const out: Record<string, TemplateConfig> = {};
  for (const form of CONTRACT_FORMS) {
    const templateId = ids[form.key];
    if (!templateId) continue; // not live until its id is configured
    out[form.key] = {
      templateId,
      label: form.label,
      roleMapping: form.roleMapping,
      purpose: form.purpose as TemplateConfig["purpose"],
      board: form.board,
      fieldMap: form.fieldMap,
    };
  }
  // Env entries override / extend the committed registry.
  return { ...out, ...parseConfig() };
}

export function getTemplateConfig(formKey: string): TemplateConfig {
  // A committed form whose id isn't set yet → a clear "not live" error rather
  // than "unknown form".
  const committedNoId =
    CONTRACT_FORMS.some((f) => f.key === formKey) && !parseTemplateIds()[formKey];

  const entry = allForms()[formKey];
  if (!entry) {
    if (committedNoId) {
      throw new TemplateConfigError(
        `form "${formKey}" has no template id yet — set it in DOCUSIGN_TEMPLATE_IDS to go live`
      );
    }
    throw new UnknownFormError(
      `no DocuSign template configured for form "${formKey}"`
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
  const config = allForms();
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
