import type { AppConfig } from "../../config.js";
import { createGeminiClient } from "./gemini.js";
import type { LlmClients } from "./types.js";

export function createLlmClients(config: AppConfig): LlmClients {
  return {
    gemini: createGeminiClient(config),
  };
}

export {
  assertUsableShopperEvidence,
  isUsableShopperEvidence,
  queryCoversProviders,
  queryHasUsableShopperEvidence,
  SHOPPER_EVIDENCE_MISSING,
  shopperEvidenceProvider,
} from "./shopper-evidence.js";
export {
  type EnabledDiagnosticClient,
  enabledDiagnosticClients,
  LLM_PROVIDER_IDS,
  type LlmBatchProbeResult,
  type LlmClient,
  type LlmClients,
  type LlmProbeResult,
  type LlmProvider,
  type LlmProviderId,
  type LlmStructuredDiagnosticResult,
} from "./types.js";
