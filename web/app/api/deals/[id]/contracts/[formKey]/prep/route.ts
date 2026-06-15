import { error, json, withAuth } from "@/lib/http";
import { prisma } from "@/lib/db";
import { resolveUserId } from "@/lib/users";
import {
  getTemplateConfig,
  TemplateConfigError,
  UnknownFormError,
} from "@/lib/docusign-templates";
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
    try {
      template = getTemplateConfig(formKey);
    } catch (err) {
      if (err instanceof UnknownFormError) return error(err.message, 400);
      if (err instanceof TemplateConfigError) return error(err.message, 500);
      throw err;
    }
    if (template.board && template.board !== deal.market) {
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
