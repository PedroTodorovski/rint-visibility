import type { AppConfig } from "../../config.js";
import { createClaudeClient } from "./claude.js";
import { createGeminiClient } from "./gemini.js";
import { createOpenAiClient } from "./openai.js";
import type { LlmClients } from "./types.js";

export function createLlmClients(config: AppConfig): LlmClients {
  return {
    claude: createClaudeClient(config),
    chatgpt: createOpenAiClient(config),
    gemini: createGeminiClient(config),
  };
}

export type { LlmBatchProbeResult, LlmClient, LlmClients, LlmProbeResult, LlmProvider } from "./types.js";
