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

// We return exactly main's TemplateConfig shape (6 fields). `routing` /
// `consumerRoles` are NOT part of TemplateConfig on this base — they live on the
// paused wire-fraud branch. uploaded_forms stores them for when that merges, but
// the resolver doesn't surface them, keeping the shape identical to committed forms.
type Row = {
  id: string;
  label: string;
  board: string;
  purpose: string;
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
    fieldMap: (r.field_map ?? {}) as Record<string, FieldMapEntry>,
  };
}

const SELECT = {
  id: true,
  label: true,
  board: true,
  purpose: true,
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

/** One uploaded form resolved to a TemplateConfig, or null if not resolvable. */
export async function getAgentFormConfig(
  formKey: string,
  agentId: string,
  market: string
): Promise<TemplateConfig | null> {
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
