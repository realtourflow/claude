/**
 * Resolves an APPROVED agent-uploaded form to the exact same shape the committed
 * registry produces (TemplateConfig / TemplateListing). This is the seam that
 * lets the existing send/sign pipeline consume uploaded forms unchanged — the
 * send route and the template-listing route consult these as a fallback after
 * the committed registry. Additive: the committed path is untouched.
 *
 * Visibility mirrors committed forms: the owning agent always, plus (once
 * promoted) agents in the matching market via the same board filter
 * (board === '' || board === market).
 */
import { prisma } from "./db";
import type {
  TemplateConfig,
  TemplateListing,
  FieldMapEntry,
} from "./docusign-templates";

// We return main's TemplateConfig shape. The wire-fraud notice (#127) has merged,
// so TemplateConfig now carries `routing` / `consumerRoles`; uploaded_forms already
// stores both, so the resolver surfaces them here — keeping the shape identical to
// committed forms.
type Row = {
  id: string;
  label: string;
  board: string;
  purpose: string;
  routing: string;
  consumer_roles: unknown;
  role_mapping: unknown;
  field_map: unknown;
  docusign_template_id: string | null;
};

function toConfig(r: Row): TemplateConfig {
  return {
    templateId: r.docusign_template_id ?? "",
    label: r.label,
    roleMapping: (r.role_mapping ?? {}) as Record<string, string>,
    purpose: (r.purpose ?? "") as TemplateConfig["purpose"],
    board: r.board ?? "",
    routing: (r.routing ?? "by-role") as TemplateConfig["routing"],
    consumerRoles: (r.consumer_roles ?? []) as string[],
    fieldMap: (r.field_map ?? {}) as Record<string, FieldMapEntry>,
  };
}

const SELECT = {
  id: true,
  label: true,
  board: true,
  purpose: true,
  routing: true,
  consumer_roles: true,
  role_mapping: true,
  field_map: true,
  docusign_template_id: true,
} as const;

// A ready uploaded form is resolvable to the caller if they own it OR it's
// promoted, AND it's visible in the given market (universal or market-matched).
function visibilityWhere(agentId: string, market: string) {
  return {
    status: "ready",
    docusign_template_id: { not: null },
    OR: [{ agent_id: agentId }, { promoted: true }],
    board: { in: ["", market] },
  };
}

// uploaded_forms.id is a uuid. A committed-form key (e.g. "buyer_agency_agreement"
// or a typo like "mystery_form") is never a uuid, so it can't be an uploaded form
// — and feeding it to a uuid column makes Postgres throw. Screen it out first so
// the caller gets a clean "not found" (→ 400), not a 500 on the id cast.
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** One uploaded form resolved to a TemplateConfig, or null if not resolvable. */
export async function getAgentFormConfig(
  formKey: string,
  agentId: string,
  market: string
): Promise<TemplateConfig | null> {
  if (!UUID_RE.test(formKey)) return null;
  const row = await prisma.uploaded_forms.findFirst({
    where: { id: formKey, ...visibilityWhere(agentId, market) },
    select: SELECT,
  });
  return row ? toConfig(row) : null;
}

/** The caller's sendable uploaded forms (for the form picker). */
export async function listAgentFormsForAgent(
  agentId: string,
  market: string
): Promise<TemplateListing[]> {
  const rows = await prisma.uploaded_forms.findMany({
    where: visibilityWhere(agentId, market),
    select: SELECT,
    orderBy: { created_at: "desc" },
  });
  return rows.map((r) => {
    const cfg = toConfig(r);
    return {
      key: r.id,
      label: cfg.label,
      roles: Object.keys(cfg.roleMapping),
      roleMapping: cfg.roleMapping,
      purpose: cfg.purpose,
      board: cfg.board,
      fieldMap: cfg.fieldMap,
    };
  });
}
