import type { AppConfig } from "../../config.js";
import { createGeminiClient } from "./gemini.js";
import type { LlmClients } from "./types.js";

export function createLlmClients(config: AppConfig): LlmClients {
  return {
    gemini: createGeminiClient(config),
  };
}

export type { LlmBatchProbeResult, LlmClient, LlmClients, LlmProbeResult, LlmProvider } from "./types.js";
