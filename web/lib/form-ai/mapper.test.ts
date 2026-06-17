import { describe, it, expect, afterEach } from "vitest";
import {
  AnthropicFieldMapper,
  FieldMapperError,
  type LlmMessage,
  type MessagesCreate,
} from "@/lib/form-ai/mapper";
import { CORE_KEYS } from "@/lib/form-ai/core-keys";
import { resetEnvForTesting } from "@/lib/env";
import type { DetectedField } from "@/lib/form-ai/types";

function field(name: string): DetectedField {
  return { name, type: "text", page: 1, rect: { x: 0, y: 0, width: 0, height: 0 } };
}

function toolResponse(mappings: unknown): LlmMessage {
  return {
    content: [{ type: "tool_use", name: "propose_mappings", input: { mappings } }],
    stop_reason: "tool_use",
  };
}

afterEach(() => resetEnvForTesting());

describe("AnthropicFieldMapper.proposeMappings", () => {
  it("aligns by index, drops off-registry keys, clamps confidence, defaults missing", async () => {
    const create: MessagesCreate = async () =>
      toolResponse([
        { index: 0, core_key: "buyer_name", role: "Buyer", confidence: 0.95, rationale: "named buyer" },
        { index: 1, core_key: "totally_made_up", role: "", confidence: 0.9, rationale: "x" },
        { index: 2, core_key: "purchase_price", role: "", confidence: 1.5, rationale: "price" },
        // index 3 intentionally omitted → defaults to a null proposal
      ]);
    const mapper = new AnthropicFieldMapper(create);

    const fields = [field("buyer_printed_name"), field("random_box"), field("price"), field("blank")];
    const props = await mapper.proposeMappings({ fields, side: "buy", coreKeys: CORE_KEYS });

    expect(props).toHaveLength(4);
    expect(props[0].coreKey).toBe("buyer_name");
    expect(props[0].role).toBe("Buyer");
    expect(props[1].coreKey).toBeNull(); // off-registry → null
    expect(props[2].coreKey).toBe("purchase_price");
    expect(props[2].confidence).toBe(1); // clamped from 1.5
    expect(props[3]).toEqual({ coreKey: null, role: null, confidence: 0, rationale: "" });
  });

  it("returns [] for no fields without calling the model", async () => {
    let called = false;
    const create: MessagesCreate = async () => {
      called = true;
      return toolResponse([]);
    };
    const props = await new AnthropicFieldMapper(create).proposeMappings({
      fields: [],
      side: "both",
      coreKeys: CORE_KEYS,
    });
    expect(props).toEqual([]);
    expect(called).toBe(false);
  });

  it("throws on a model refusal", async () => {
    const create: MessagesCreate = async () => ({ content: [], stop_reason: "refusal" });
    await expect(
      new AnthropicFieldMapper(create).proposeMappings({
        fields: [field("a")],
        side: "buy",
        coreKeys: CORE_KEYS,
      })
    ).rejects.toBeInstanceOf(FieldMapperError);
  });

  it("throws when no tool_use block is returned", async () => {
    const create: MessagesCreate = async () => ({
      content: [{ type: "text", text: "hi" }],
      stop_reason: "end_turn",
    });
    await expect(
      new AnthropicFieldMapper(create).proposeMappings({
        fields: [field("a")],
        side: "buy",
        coreKeys: CORE_KEYS,
      })
    ).rejects.toBeInstanceOf(FieldMapperError);
  });

  it("enabled() reflects ANTHROPIC_API_KEY presence", () => {
    const saved = process.env.ANTHROPIC_API_KEY;
    try {
      delete process.env.ANTHROPIC_API_KEY;
      resetEnvForTesting();
      expect(new AnthropicFieldMapper().enabled()).toBe(false);
      process.env.ANTHROPIC_API_KEY = "sk-test";
      resetEnvForTesting();
      expect(new AnthropicFieldMapper().enabled()).toBe(true);
    } finally {
      if (saved === undefined) delete process.env.ANTHROPIC_API_KEY;
      else process.env.ANTHROPIC_API_KEY = saved;
      resetEnvForTesting();
    }
  });
});
