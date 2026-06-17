/**
 * Form-AI types: the contract between the deterministic field extractor and the
 * swappable AI field-mapper. See ./mapper.ts (provider) and ./extract.ts
 * (pdf-lib). Part of the agent form-upload pipeline (docs/agent-form-upload-pipeline.md).
 */

// Structural type of a detected fillable field. `type` is the PDF widget kind;
// "date"/"initial" are reserved for future extractors (AcroForm rarely encodes
// them distinctly), and "unknown" is a fillable we couldn't classify.
export type DetectedFieldType =
  | "text"
  | "checkbox"
  | "signature"
  | "initial"
  | "date"
  | "unknown";

export type DetectedField = {
  // The AcroForm field name (the strongest signal for mapping). When a field has
  // multiple widgets, each widget is emitted as "name#1", "name#2", … .
  name: string;
  type: DetectedFieldType;
  // 1-based page number the widget sits on.
  page: number;
  // Widget rectangle in PDF user space (origin bottom-left). Carried so the
  // DocuSign template tab can be placed exactly here at approval (step 5).
  rect: { x: number; y: number; width: number; height: number };
  // Optional nearby label/caption text — extra context for the mapper. Not
  // populated by the v2 AcroForm extractor (the field name carries the signal).
  nearbyText?: string;
};

// One human-readable core key the mapper may target. Built FROM the existing
// registry (FACT_FIELDS + AUTO_VALUE_KEYS) — never a parallel set. See core-keys.ts.
export type CoreKeyDescriptor = {
  key: string;
  kind: string; // "text" | "number" | "date" | "json" | "identity"
  description: string;
};

// The mapper's proposal for one detected field. coreKey === null means "no
// confident mapping" (an explicit decline, never a guess). confidence is 0..1.
export type CoreKeyProposal = {
  coreKey: string | null;
  role: string | null;
  confidence: number;
  rationale: string;
};

export type MapperInput = {
  fields: DetectedField[];
  side: "buy" | "sell" | "both";
  coreKeys: CoreKeyDescriptor[];
};

// The provider-swappable seam. One interface, injected fake in tests
// (setFieldMapperForTesting), Anthropic Claude as the default impl. Returns one
// proposal per input field, aligned by index.
export interface FieldMapper {
  proposeMappings(input: MapperInput): Promise<CoreKeyProposal[]>;
}
