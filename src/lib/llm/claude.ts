import type { AppConfig } from "../../config.js";
import {
  batchMaxTokens,
  buildBatchProbeMessage,
  parseBatchProbeResponse,
  type BatchProbeItem,
} from "./batch-probe.js";
import type { LlmBatchProbeResult, LlmClient, LlmProbeResult } from "./types.js";

const DEFAULT_MODEL = "claude-haiku-4-5-20251001";
const API_URL = "https://api.anthropic.com/v1/messages";

async function callClaude(
  apiKey: string,
  model: string,
  userContent: string,
  maxTokens: number,
): Promise<{ text: string; model: string } | null> {
  const res = await fetch(API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      messages: [{ role: "user", content: userContent }],
    }),
    signal: AbortSignal.timeout(90_000),
  });

  if (!res.ok) return null;

  const data = (await res.json()) as {
    content?: Array<{ type: string; text?: string }>;
    model?: string;
  };

  const text = data.content?.find((block) => block.type === "text")?.text?.trim() ?? "";
  return { text, model: data.model ?? model };
}

export function createClaudeClient(config: AppConfig): LlmClient {
  const apiKey = config.anthropicApiKey;
  const model = config.anthropicModel ?? DEFAULT_MODEL;

  return {
    async probe(prompt: string): Promise<LlmProbeResult> {
      if (!apiKey) {
        return { text: "", model: "mock", mocked: true };
      }

      try {
        const result = await callClaude(apiKey, model, prompt, 1024);
        if (!result || !result.text) {
          return { text: "", model: "mock", mocked: true };
        }
        return { text: result.text, model: result.model, mocked: false };
      } catch {
        return { text: "", model: "mock", mocked: true };
      }
    },

    async probeBatch(items: BatchProbeItem[]): Promise<LlmBatchProbeResult> {
      if (items.length === 0) {
        return { responses: [], model: "mock", mocked: true };
      }

      if (!apiKey) {
        return { responses: [], model: "mock", mocked: true };
      }

      try {
        const message = buildBatchProbeMessage(items);
        const result = await callClaude(apiKey, model, message, batchMaxTokens(items.length));
        if (!result || !result.text) {
          return { responses: [], model: "mock", mocked: true };
        }

        const expectedIndexes = items.map((item) => item.index);
        const parsed = parseBatchProbeResponse(result.text, expectedIndexes);
        const responses = items.map((item) => ({
          index: item.index,
          text: parsed.get(item.index) ?? "",
        }));

        const complete = responses.every((row) => row.text.length > 0);
        return {
          responses,
          model: result.model,
          mocked: !complete,
        };
      } catch {
        return { responses: [], model: "mock", mocked: true };
      }
    },
  };
}
