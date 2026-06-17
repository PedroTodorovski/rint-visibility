import type { AppConfig } from "../../config.js";
import { createGeminiClient } from "./gemini.js";
import { createOpenAiClient } from "./openai.js";
import type { LlmClients } from "./types.js";

export function createLlmClients(config: AppConfig): LlmClients {
  return {
    chatgpt: createOpenAiClient(config),
    gemini: createGeminiClient(config),
  };
}

export type { LlmClient, LlmClients, LlmProbeResult, LlmProvider } from "./types.js";
