/**
 * The swappable AI field-mapper. Default implementation is Anthropic Claude
 * (model from FORM_AI_MODEL, defaulting to the latest Opus); the provider lives
 * behind the FieldMapper interface so it can be replaced without touching callers.
 *
 * Test seam mirrors lib/docusign: setFieldMapperForTesting() injects a whole fake
 * mapper for route tests, and AnthropicFieldMapper takes an injectable `create`
 * so the prompt-build / parse / validate logic is unit-tested without the SDK or
 * a network call (see mapper.test.ts). CI never needs an ANTHROPIC_API_KEY.
 */
import Anthropic from "@anthropic-ai/sdk";
import { env } from "../env";
import { isCoreKey } from "./core-keys";
import type { FieldMapper, MapperInput, CoreKeyProposal } from "./types";

export class FieldMapperError extends Error {}

// Minimal structural shape of the Messages response we read — keeps tests free of
// SDK message construction. The real Anthropic.Message satisfies it structurally.
export type LlmMessage = {
  content: Array<{ type: string } & Record<string, unknown>>;
  stop_reason?: string | null;
};
export type MessagesCreate = (body: unknown) => Promise<LlmMessage>;

const TOOL_NAME = "propose_mappings";

const PROPOSE_TOOL = {
  name: TOOL_NAME,
  description:
    "Return the proposed core-key mapping for every detected field, one entry per field index.",
  input_schema: {
    type: "object",
    properties: {
      mappings: {
        type: "array",
        items: {
          type: "object",
          properties: {
            index: { type: "integer", description: "0-based index of the detected field" },
            core_key: {
              type: "string",
              description: "a core key from the allowed list, or empty string if none fits",
            },
            role: {
              type: "string",
              description: "signing party who fills the field (Buyer/Seller/Agent…), or empty",
            },
            confidence: { type: "number", description: "0..1 confidence in the mapping" },
            rationale: { type: "string", description: "one short sentence of why" },
          },
          required: ["index", "core_key", "role", "confidence", "rationale"],
        },
      },
    },
    required: ["mappings"],
  },
} as const;

const SYSTEM_PROMPT = [
  "You map detected PDF form fields to a fixed registry of contract data keys for",
  "a real-estate e-signing app. You get the allowed core keys (with descriptions)",
  "and the fields detected on one blank form. For each field, choose the single",
  "core key it should be pre-filled from, or leave it unmapped.",
  "",
  "Rules:",
  "1. Only use a key from the provided list. Never invent a key.",
  "2. Return an empty string for core_key when no key clearly fits — e.g. a",
  "   signature/initial line, a date the signer writes in, a checkbox election, or",
  "   anything ambiguous.",
  "3. Set confidence 0..1 honestly. High only when the field name clearly matches",
  "   the key's meaning.",
  "4. role is the signing party who fills the field (Buyer, Seller, Agent, …) when",
  "   inferable, else empty.",
  "5. One entry per field, addressed by its index.",
  "Prefer leaving a field unmapped over a wrong guess — a human reviews everything.",
].join("\n");

function buildUserPrompt(input: MapperInput): string {
  const keys = input.coreKeys
    .map((c) => `- ${c.key} (${c.kind}): ${c.description}`)
    .join("\n");
  const fields = input.fields
    .map(
      (f, i) =>
        `${i}: name="${f.name}" type=${f.type} page=${f.page}` +
        (f.nearbyText ? ` near="${f.nearbyText}"` : "")
    )
    .join("\n");
  return [
    `Form side: ${input.side}`,
    "",
    "Allowed core keys:",
    keys,
    "",
    "Detected fields:",
    fields,
    "",
    `Return a mapping for every field index using the ${TOOL_NAME} tool.`,
  ].join("\n");
}

function clamp01(n: unknown): number {
  const v = typeof n === "number" ? n : Number(n);
  if (!Number.isFinite(v)) return 0;
  return Math.max(0, Math.min(1, v));
}

// Validate the model output into aligned proposals. Off-registry or empty keys
// become null; out-of-range indices are ignored; missing indices default to a
// null proposal. Never throws on bad data — only the request layer throws.
function normalize(raw: unknown, count: number): CoreKeyProposal[] {
  const out: CoreKeyProposal[] = Array.from({ length: count }, () => ({
    coreKey: null,
    role: null,
    confidence: 0,
    rationale: "",
  }));
  if (!Array.isArray(raw)) return out;
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    const idx = typeof row.index === "number" ? row.index : Number(row.index);
    if (!Number.isInteger(idx) || idx < 0 || idx >= count) continue;
    const key = typeof row.core_key === "string" ? row.core_key.trim() : "";
    const role = typeof row.role === "string" ? row.role.trim() : "";
    out[idx] = {
      coreKey: key !== "" && isCoreKey(key) ? key : null,
      role: role !== "" ? role : null,
      confidence: clamp01(row.confidence),
      rationale: typeof row.rationale === "string" ? row.rationale : "",
    };
  }
  return out;
}

export class AnthropicFieldMapper implements FieldMapper {
  constructor(private readonly create?: MessagesCreate) {}

  enabled(): boolean {
    return !!env().ANTHROPIC_API_KEY;
  }

  async proposeMappings(input: MapperInput): Promise<CoreKeyProposal[]> {
    if (input.fields.length === 0) return [];
    const create = this.create ?? this.realCreate();

    const body = {
      model: env().FORM_AI_MODEL,
      max_tokens: 4096,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: buildUserPrompt(input) }],
      tools: [PROPOSE_TOOL],
      tool_choice: { type: "tool", name: TOOL_NAME },
    };

    let res: LlmMessage;
    try {
      res = await create(body);
    } catch (err) {
      throw new FieldMapperError(
        `field mapping request failed: ${(err as Error).message}`
      );
    }

    if (res.stop_reason === "refusal") {
      throw new FieldMapperError("field mapping refused by the model");
    }
    const tool = res.content.find((b) => b.type === "tool_use");
    if (!tool) {
      throw new FieldMapperError("model returned no tool_use block");
    }
    const mappings = (tool.input as { mappings?: unknown } | undefined)?.mappings;
    return normalize(mappings, input.fields.length);
  }

  private realCreate(): MessagesCreate {
    const apiKey = env().ANTHROPIC_API_KEY;
    if (!apiKey) {
      throw new FieldMapperError("ANTHROPIC_API_KEY is not set");
    }
    const client = new Anthropic({ apiKey });
    return async (body: unknown) => {
      const msg = await client.messages.create(
        body as Anthropic.MessageCreateParamsNonStreaming
      );
      return msg as unknown as LlmMessage;
    };
  }
}

let stub: FieldMapper | undefined;
let real: FieldMapper | undefined;

/** Test seam — inject a fake mapper (route tests). Pass undefined to reset. */
export function setFieldMapperForTesting(m: FieldMapper | undefined): void {
  stub = m;
}

export function getFieldMapper(): FieldMapper {
  if (stub) return stub;
  if (!real) real = new AnthropicFieldMapper();
  return real;
}
