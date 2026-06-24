/**
 * Public surface of the form-AI module (agent form-upload pipeline).
 * Extraction is deterministic (pdf-lib); mapping is the swappable AI seam.
 */
export type {
  DetectedField,
  DetectedFieldType,
  CoreKeyDescriptor,
  CoreKeyProposal,
  MapperInput,
  FieldMapper,
} from "./types";
export { extractAcroFields } from "./extract";
export { CORE_KEYS, isCoreKey } from "./core-keys";
export {
  AnthropicFieldMapper,
  FieldMapperError,
  getFieldMapper,
  setFieldMapperForTesting,
} from "./mapper";
