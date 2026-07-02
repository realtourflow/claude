/**
 * Resolves an APPROVED agent-uploaded form to the exact same shape the committed
 * registry produces (TemplateConfig / TemplateListing). This is the seam that
 * lets the existing send/sign pipeline consume uploaded forms unchanged — the
 * send route and the template-listing route consult these as a fallback after
 * the committed registry. Additive: the committed path is untouched.
 *
 * Visibility: the owning agent always sees their own approved forms. Beyond the
 * owner, a form is visible to an agent iff the admin promoted it to a COMPANY +
 * MARKET combo (form_promotions) matching the agent's profile — same brokerage
 * AND the combo's market is one of the agent's markets. Computed live from the
 * profile, so agents who onboard later match automatically with no manual push.
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

/** The caller's profile fields that decide which promoted forms they match. */
export type AgentFormViewer = {
  agentId: string;
  brokerage: string;
  markets: string[];
};

// A ready uploaded form is resolvable to the caller if they own it OR the admin
// promoted it to their company + one of their markets. The brokerage match is
// case-insensitive as defense in depth — profile writes canonicalize to the
// managed list's spelling, but a legacy/hand-edited value must still match.
function visibilityWhere(viewer: AgentFormViewer) {
  const markets = viewer.markets.length > 0 ? viewer.markets : ["__none__"];
  return {
    status: "ready",
    docusign_template_id: { not: null },
    OR: [
      { agent_id: viewer.agentId },
      ...(viewer.brokerage
        ? [
            {
              form_promotions: {
                some: {
                  brokerage: { equals: viewer.brokerage, mode: "insensitive" as const },
                  market: { in: markets },
                },
              },
            },
          ]
        : []),
    ],
  };
}

// uploaded_forms.id is a uuid. A committed-form key (e.g. "buyer_agency_agreement"
// or a typo like "mystery_form") is never a uuid, so it can't be an uploaded form
// — and feeding it to a uuid column makes Postgres throw. Screen it out first so
// the caller gets a clean "not found" (→ 400), not a 500 on the id cast.
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Fetch the viewer profile fields for a user id (brokerage + markets). */
export async function agentFormViewer(agentId: string): Promise<AgentFormViewer> {
  const u = await prisma.users.findUnique({
    where: { id: agentId },
    select: { brokerage: true, market: true, markets: true },
  });
  const markets = Array.isArray(u?.markets) ? (u.markets as string[]) : [];
  return {
    agentId,
    brokerage: u?.brokerage ?? "",
    // Legacy fallback: a profile written before multi-market (markets empty but
    // a primary market set) still matches promotions for that market.
    markets: markets.length > 0 ? markets : u?.market ? [u.market] : [],
  };
}

/** One uploaded form resolved to a TemplateConfig, or null if not resolvable. */
export async function getAgentFormConfig(
  formKey: string,
  viewer: AgentFormViewer
): Promise<TemplateConfig | null> {
  if (!UUID_RE.test(formKey)) return null;
  const row = await prisma.uploaded_forms.findFirst({
    where: { id: formKey, ...visibilityWhere(viewer) },
    select: SELECT,
  });
  return row ? toConfig(row) : null;
}

/** The caller's sendable uploaded forms (for the form picker). */
export async function listAgentFormsForAgent(
  viewer: AgentFormViewer
): Promise<TemplateListing[]> {
  const rows = await prisma.uploaded_forms.findMany({
    where: visibilityWhere(viewer),
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
