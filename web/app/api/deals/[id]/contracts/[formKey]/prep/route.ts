import { error, json, withAuth } from "@/lib/http";
import { prisma } from "@/lib/db";
import { resolveUserId } from "@/lib/users";
import {
  getTemplateConfig,
  TemplateConfigError,
  UnknownFormError,
} from "@/lib/docusign-templates";
import { getAgentFormConfig, agentFormViewer } from "@/lib/agent-forms";
import {
  AUTO_VALUE_KEYS,
  FACT_FIELDS,
  getMergedContractValues,
  type FactKey,
} from "@/lib/contract-facts";

const AUTO_KEYS = new Set<string>(AUTO_VALUE_KEYS);

type Ctx = { params: Promise<{ id: string; formKey: string }> };

// Serialize a merged value for the prep screen: dates as YYYY-MM-DD, numbers/
// decimals as plain strings, booleans as-is.
function serialize(value: unknown): unknown {
  if (value === undefined || value === null) return null;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === "boolean") return value;
  if (typeof value === "object") return value;
  return String(value);
}

// GET /api/deals/[id]/contracts/[formKey]/prep — the merged field set the
// agent reviews before sending: core facts (prefilled from the deal) + the
// form's board-specific fields (from saved terms / blank). Owner-agent only;
// the form must belong to the deal's market (or be universal).
export async function GET(req: Request, ctx: Ctx): Promise<Response> {
  const { id: dealId, formKey } = await ctx.params;
  return (await withAuth(req, async (claims): Promise<Response> => {
    const userId = await resolveUserId(claims.sub);
    if (!userId) return error("user not found", 404);

    const deal = await prisma.deals.findFirst({
      where: { id: dealId, agent_id: userId },
      select: { id: true, market: true },
    });
    if (!deal) return error("deal not found or access denied", 404);

    let template;
    let isAgentForm = false;
    try {
      template = getTemplateConfig(formKey);
    } catch (err) {
      if (err instanceof UnknownFormError) {
        // Fall back to an approved agent-uploaded form — same TemplateConfig
        // shape, so the merge below is reused unchanged. Mirrors the
        // send-template route's resolution exactly (#195): visible if the
        // caller owns it or the admin promoted it to their company + market.
        const viewer = await agentFormViewer(userId);
        const agentForm = await getAgentFormConfig(formKey, viewer);
        if (!agentForm) return error(err.message, 400);
        // DEAL scope (distinct from visibility): a board-keyed uploaded
        // contract only preps on a deal in that market — unless a promotion
        // combo for the caller's company explicitly covers the DEAL's market.
        // Same rule the send-template route enforces at send time.
        if (agentForm.board && agentForm.board !== deal.market) {
          const covering = viewer.brokerage
            ? await prisma.form_promotions.findFirst({
                where: {
                  form_id: formKey,
                  brokerage: { equals: viewer.brokerage, mode: "insensitive" },
                  market: deal.market,
                },
                select: { id: true },
              })
            : null;
          if (!covering) {
            return error(
              `form "${agentForm.label}" belongs to board ${agentForm.board}; this deal's market is ${deal.market || "unset"}`,
              400
            );
          }
        }
        template = agentForm;
        isAgentForm = true;
      } else if (err instanceof TemplateConfigError) {
        return error(err.message, 500);
      } else {
        throw err;
      }
    }
    // Board-keyed COMMITTED forms only prep on deals in that market. Uploaded
    // forms passed their own deal-scope check above.
    if (!isAgentForm && template.board && template.board !== deal.market) {
      return error(
        `form "${formKey}" belongs to board ${template.board}; this deal's market is ${deal.market || "unset"}`,
        400
      );
    }

    const values = await getMergedContractValues(dealId, formKey);

    const core = (Object.keys(FACT_FIELDS) as FactKey[]).map((key) => ({
      key,
      type: FACT_FIELDS[key],
      value: serialize(values[key]),
    }));

    const board_fields = Object.entries(template.fieldMap)
      // Exclude core facts (shown in `core`) and auto-sourced party/agent
      // fields (filled automatically, not agent-editable).
      .filter(([key]) => !(key in FACT_FIELDS) && !AUTO_KEYS.has(key))
      .map(([key, entry]) => ({
        key,
        label: entry.label,
        type: entry.type,
        ...(entry.role ? { role: entry.role } : {}),
        value: serialize(values[key]),
      }));

    return json({
      form: { key: formKey, label: template.label, board: template.board },
      core,
      board_fields,
    });
  })) as Response;
}
